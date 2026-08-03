import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startPledgeCheckout } from '../start-pledge-client';

/**
 * `/api/pledges/start` answers 409 for TWO different situations, and the family
 * needs opposite treatment for each:
 *
 *  - `already-live`      - nothing to act on; the screen is stale, so reload it.
 *  - `enrollment-required` - very much something to act on; join Bala Vihar.
 *
 * Collapsing them (the original `if (res.status === 409) return 'already-live'`)
 * would answer "you already have a monthly gift in progress" to a family that
 * has none, then reload into the same ask - which reads as a dead button.
 *
 * This module had no tests at all. Both branches are cheap to pin and this is
 * the layer where the two 409s are told apart.
 */
function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startPledgeCheckout', () => {
  it('returns the hosted url on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { pid: 'PLG-1', checkoutUrl: 'https://stripe.test/cs_1' }));
    expect(await startPledgeCheckout()).toEqual({ ok: true, checkoutUrl: 'https://stripe.test/cs_1' });
  });

  it('distinguishes "enroll first" from "you already have one" - both are 409', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'enrollment-required' }));
    expect(await startPledgeCheckout()).toEqual({ ok: false, reason: 'enrollment-required' });
  });

  it('distinguishes an EMPTIED enrollment from a missing one', async () => {
    // Both are 409. Falling through to the catch-all would announce "you already
    // have a monthly donation in progress" and hard-reload the family into the
    // same dead end, for a state they are not in.
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'no-enrolled-members' }));
    expect(await startPledgeCheckout()).toEqual({ ok: false, reason: 'no-enrolled-members' });

    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'already-active', pid: 'PLG-OLD' }));
    expect(await startPledgeCheckout()).toEqual({ ok: false, reason: 'already-live' });
  });

  it('sends no amount - what is debited lives at Stripe, never in the client', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { checkoutUrl: 'https://stripe.test/cs_2' }));
    await startPledgeCheckout();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{}');
  });

  it('maps 401 to unauthorized without reading the body', async () => {
    fetchMock.mockResolvedValue({ status: 401, ok: false, json: async () => { throw new Error('no body'); } } as unknown as Response);
    expect(await startPledgeCheckout()).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('maps a dark feature (404) and a provider outage (503) to the same "unavailable"', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'not-found' }));
    expect(await startPledgeCheckout()).toEqual({ ok: false, reason: 'unavailable' });

    fetchMock.mockResolvedValue(jsonResponse(503, { error: 'provider-unavailable' }));
    expect(await startPledgeCheckout()).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('treats a 2xx with no checkoutUrl as an error rather than navigating to undefined', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { pid: 'PLG-1' }));
    expect(await startPledgeCheckout()).toEqual({ ok: false, reason: 'error' });
  });
});
