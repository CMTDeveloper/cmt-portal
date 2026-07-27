import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createPadSetupLink,
  getCheckoutSessionResult,
  createMonthlySubscription,
  getSubscriptionResult,
  pledgeIdempotencyKey,
  PadClientError,
} from '../stripe-pad-client';

/**
 * The ONLY surface that talks to the payment service about pledges.
 *
 * Two properties are asserted here rather than trusted:
 *  1. **Fail closed.** Missing config must throw BEFORE any network call. A
 *     client that quietly no-ops, or worse calls a half-configured endpoint, is
 *     how a family ends up believing they authorised a debit that does not
 *     exist.
 *  2. **No bank detail ever crosses this boundary.** Every request body is
 *     asserted to carry only identifiers - the mandate is collected on the
 *     hosted page and never passes through the portal.
 */

const BASE = 'https://pay.example.test';
const KEY = 'test-api-key';
const PRICE = 'price_test_123';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  global.fetch = fn as never;
  return fn;
}
function lastCall(fn: ReturnType<typeof vi.fn>) {
  const [url, init] = fn.mock.calls[fn.mock.calls.length - 1] as [string, RequestInit];
  return { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

beforeEach(() => {
  process.env.STRIPE_API_BASE_URL = BASE;
  process.env.STRIPE_API_KEY = KEY;
  process.env.STRIPE_PLEDGE_PRICE_ID = PRICE;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.STRIPE_API_BASE_URL;
  delete process.env.STRIPE_API_KEY;
  delete process.env.STRIPE_PLEDGE_PRICE_ID;
});

const setupArgs = {
  customerEmail: 'a@b.com',
  customerName: 'Asha Apple',
  clientReferenceId: 'PLG-1',
  successUrl: 'https://portal.test/donate/success',
  cancelUrl: 'https://portal.test/family',
  metadata: { fid: 'CMT-A', pid: 'PLG-1' },
};

describe('fail closed', () => {
  it.each([
    ['STRIPE_API_BASE_URL', 'STRIPE_API_BASE_URL'],
    ['STRIPE_API_KEY', 'STRIPE_API_KEY'],
  ])('throws WITHOUT calling when %s is unset', async (_label, key) => {
    const fetchFn = mockFetch(200, {});
    delete process.env[key];
    await expect(createPadSetupLink(setupArgs)).rejects.toBeInstanceOf(PadClientError);
    // The assertion that matters: nothing was sent. A half-configured call is
    // worse than no call - it can create state at the provider we never record.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('step 4 fails closed when the PRICE id is unset', async () => {
    const fetchFn = mockFetch(200, {});
    delete process.env.STRIPE_PLEDGE_PRICE_ID;
    await expect(createMonthlySubscription({ setupSessionId: 'cs_1', pid: 'PLG-1' })).rejects.toBeInstanceOf(
      PadClientError,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('the fail-closed error names the missing variable, not just "misconfigured"', async () => {
    mockFetch(200, {});
    delete process.env.STRIPE_PLEDGE_PRICE_ID;
    await expect(createMonthlySubscription({ setupSessionId: 'cs_1', pid: 'PLG-1' })).rejects.toThrow(
      /STRIPE_PLEDGE_PRICE_ID/,
    );
  });
});

describe('createPadSetupLink (call 1)', () => {
  it('posts to /pad/setup-link with the api key and returns the hosted url', async () => {
    const fetchFn = mockFetch(200, { checkoutUrl: 'https://stripe.test/cs_1', sessionId: 'cs_1', customerId: 'cus_1' });
    const out = await createPadSetupLink(setupArgs);
    const { url, init, body } = lastCall(fetchFn);
    expect(url).toBe(`${BASE}/pad/setup-link`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expect(body.client_reference_id).toBe('PLG-1');
    expect(out).toEqual({ checkoutUrl: 'https://stripe.test/cs_1', sessionId: 'cs_1', customerId: 'cus_1' });
  });

  it('sends identifiers only - never anything bank-ish', async () => {
    const fetchFn = mockFetch(200, { checkoutUrl: 'u', sessionId: 's', customerId: 'c' });
    await createPadSetupLink(setupArgs);
    const { body } = lastCall(fetchFn);
    const flat = JSON.stringify(body).toLowerCase();
    for (const forbidden of ['account', 'transit', 'institution', 'iban', 'routing', 'sortcode']) {
      expect(flat, `request body must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('sends a non-empty branding_settings.display_name', async () => {
    // REGRESSION (2026-07-27, found in production): this sent
    // `branding_settings: {}` and the payment service answered
    // `400 Invalid branding_settings.display_name`, so EVERY pledge failed
    // before the family ever saw Stripe. The one-time donation route had always
    // sent the display name; only this path omitted it. The name is also what
    // the family reads on the Stripe-hosted mandate page - an empty one would
    // ask them to authorise a recurring debit to nobody in particular.
    const fetchFn = mockFetch(200, { checkoutUrl: 'u', sessionId: 's', customerId: 'c' });
    await createPadSetupLink(setupArgs);
    const { body } = lastCall(fetchFn);
    const branding = body['branding_settings'] as { display_name?: unknown } | undefined;
    expect(branding, 'no branding_settings sent').toBeDefined();
    expect(typeof branding!.display_name).toBe('string');
    expect((branding!.display_name as string).length).toBeGreaterThan(0);
  });

  it('throws a typed error on a non-2xx, carrying the status', async () => {
    mockFetch(502, { error: 'upstream' });
    await expect(createPadSetupLink(setupArgs)).rejects.toBeInstanceOf(PadClientError);
    await expect(createPadSetupLink(setupArgs)).rejects.toThrow(/502/);
  });

  it("carries the provider's own error text, not just the status code", async () => {
    // The reason the branding bug above cost a live debugging session: the
    // client threw `/pad/setup-link failed with 400` and DROPPED the response
    // body, so `lastError` on the pledge doc named a status and nothing else.
    // The service had said exactly what was wrong; we threw it away.
    mockFetch(400, { error: 'Invalid branding_settings.display_name' });
    await expect(createPadSetupLink(setupArgs)).rejects.toThrow(/Invalid branding_settings\.display_name/);
  });

  it('throws when a 200 body is missing the checkout url', async () => {
    // A 200 with no url would otherwise return undefined and redirect the family
    // to "undefined" - a broken page, after they intended to give money.
    mockFetch(200, { sessionId: 'cs_1' });
    await expect(createPadSetupLink(setupArgs)).rejects.toBeInstanceOf(PadClientError);
  });
});

describe('result calls (3 and 5)', () => {
  it('getCheckoutSessionResult posts the sessionId and returns the status', async () => {
    const fetchFn = mockFetch(200, { status: 'success' });
    const out = await getCheckoutSessionResult('cs_1');
    const { url, body } = lastCall(fetchFn);
    expect(url).toBe(`${BASE}/checkout-session-result`);
    expect(body).toEqual({ sessionId: 'cs_1' });
    expect(out).toBe('success');
  });

  it('getSubscriptionResult posts the subscriptionId and returns the status', async () => {
    const fetchFn = mockFetch(200, { status: 'pending' });
    const out = await getSubscriptionResult('sub_1');
    const { url, body } = lastCall(fetchFn);
    expect(url).toBe(`${BASE}/subscription-result`);
    expect(body).toEqual({ subscriptionId: 'sub_1' });
    expect(out).toBe('pending');
  });

  it('maps an UNRECOGNISED status to pending, never to success', async () => {
    // The failure direction matters: treating an unknown value as success would
    // mark a family active with no confirmed subscription. `pending` leaves it
    // for the reconciler, which is the safe reading of "we do not understand
    // this answer".
    mockFetch(200, { status: 'weird-new-value' });
    expect(await getCheckoutSessionResult('cs_1')).toBe('pending');
  });

  it('maps a MISSING status to pending', async () => {
    mockFetch(200, {});
    expect(await getSubscriptionResult('sub_1')).toBe('pending');
  });
});

describe('createMonthlySubscription (call 4)', () => {
  it('posts the setup session, the price and a derived idempotency key', async () => {
    const fetchFn = mockFetch(200, { subscriptionId: 'sub_1', status: 'active', customerId: 'cus_1' });
    const out = await createMonthlySubscription({ setupSessionId: 'cs_1', pid: 'PLG-1' });
    const { url, body } = lastCall(fetchFn);
    expect(url).toBe(`${BASE}/pad/monthly-subscription`);
    expect(body).toMatchObject({ setupSessionId: 'cs_1', priceId: PRICE, idempotencyKey: 'pledge-PLG-1' });
    expect(out.subscriptionId).toBe('sub_1');
  });

  it('derives the SAME key for the same pledge, so a retry cannot double-subscribe', async () => {
    // Vaibhav confirmed step 4 is safe to retry with the same setupSessionId;
    // that guarantee is worth nothing if each attempt mints a fresh key.
    expect(pledgeIdempotencyKey('PLG-1')).toBe(pledgeIdempotencyKey('PLG-1'));
    expect(pledgeIdempotencyKey('PLG-1')).not.toBe(pledgeIdempotencyKey('PLG-2'));
  });

  it('does NOT vary the key with the price id', async () => {
    // The plan proposed `${pid}-${priceId}`. That is the wrong failure
    // direction: if the Price changed between the family authorising and the
    // reconciler retrying, a price-dependent key would create a SECOND
    // subscription at the new amount, silently, for a family who agreed to the
    // old one. A pid-only key makes Stripe return the original instead - and if
    // it refuses the mismatch, the reconciler records lastError and a human
    // looks, which is the safe outcome.
    process.env.STRIPE_PLEDGE_PRICE_ID = 'price_changed_since';
    const fetchFn = mockFetch(200, { subscriptionId: 'sub_1', status: 'active' });
    await createMonthlySubscription({ setupSessionId: 'cs_1', pid: 'PLG-1' });
    expect(lastCall(fetchFn).body.idempotencyKey).toBe('pledge-PLG-1');
  });

  it('throws when a 200 body carries no subscriptionId', async () => {
    mockFetch(200, { status: 'active' });
    await expect(createMonthlySubscription({ setupSessionId: 'cs_1', pid: 'PLG-1' })).rejects.toBeInstanceOf(
      PadClientError,
    );
  });
});
