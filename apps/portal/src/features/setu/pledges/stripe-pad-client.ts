import 'server-only';

/**
 * The ONLY place the portal talks to the payment service about pledges.
 *
 * Every pledge call goes through here. A direct `fetch` elsewhere would bypass
 * the fail-closed configuration check and the shared error mapping - the same
 * reason `sendManagedEmail` must go through `resolveSender()` rather than
 * reaching for `./ses`.
 *
 * ── What never crosses this boundary ────────────────────────────────────────
 * The pre-authorized debit is authorised on a Stripe-HOSTED page. No account
 * number, transit number, institution number or mandate is ever sent, received,
 * logged or stored here. The request bodies below carry identifiers only, and a
 * test asserts that.
 *
 * ── The five-call contract (spec §0) ────────────────────────────────────────
 *   1 POST {BASE}/pad/setup-link           → { checkoutUrl, sessionId, customerId }
 *   2 (browser redirect to the hosted page - no call)
 *   3 POST {BASE}/checkout-session-result  → success | failed | pending
 *   4 POST {BASE}/pad/monthly-subscription → { subscriptionId, status, ... }
 *   5 POST {BASE}/subscription-result      → success | failed | pending
 *
 * `STRIPE_CHECKOUT_URL` (the one-time donation flow) is this same service's base
 * plus `/checkout-link`, and is deliberately left alone.
 */

/** Provider outcome vocabulary, shared by calls 3 and 5. */
export type PadResult = 'success' | 'failed' | 'pending';

export class PadClientError extends Error {
  constructor(
    message: string,
    readonly reason: 'not-configured' | 'http' | 'bad-response',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PadClientError';
  }
}

interface Config {
  base: string;
  apiKey: string;
}

/**
 * Fail CLOSED, and before any network call.
 *
 * A half-configured client is worse than an absent one: it can create state at
 * the provider that the portal never records, which is precisely the orphan the
 * reconciler exists to clean up. Naming the missing variable matters too - a
 * bare "misconfigured" sends whoever is on call reading code instead of env.
 */
function config(): Config {
  const base = process.env.STRIPE_API_BASE_URL;
  const apiKey = process.env.STRIPE_API_KEY;
  if (!base) throw new PadClientError('STRIPE_API_BASE_URL is not set', 'not-configured');
  if (!apiKey) throw new PadClientError('STRIPE_API_KEY is not set', 'not-configured');
  return { base: base.replace(/\/+$/, ''), apiKey };
}

async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { base, apiKey } = config();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    // `x-api-key` matches the existing one-time checkout call
    // (api/setu/donations/checkout/route.ts:204) - one service, one key.
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new PadClientError(`${path} failed with ${res.status}`, 'http', res.status);
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/**
 * Normalise a provider status.
 *
 * Anything unrecognised - a new value, a typo, a missing field - becomes
 * `pending`, NEVER `success`. The two failure directions are not symmetric:
 * reading an unknown answer as success marks a family as giving when no
 * subscription is confirmed, while reading it as pending simply leaves the
 * pledge for the reconciler to resolve.
 */
function toResult(raw: unknown): PadResult {
  return raw === 'success' || raw === 'failed' ? raw : 'pending';
}

/**
 * The idempotency key for a pledge's subscription.
 *
 * DELIBERATELY keyed on the pledge alone, NOT on `${pid}-${priceId}` as the plan
 * proposed. If the Price changed between the family authorising the mandate and
 * the reconciler retrying step 4, a price-dependent key would silently create a
 * SECOND subscription at the new amount for a family who agreed to the old one.
 * A pid-only key makes the provider return the original instead; if it rejects
 * the parameter mismatch, that surfaces as `lastError` and a human looks. Both
 * of those are better than an unnoticed second monthly debit.
 *
 * A permanently-failed pledge is retried by starting a NEW pledge (a new pid),
 * so this never wrongly pins a family to a dead attempt.
 */
export function pledgeIdempotencyKey(pid: string): string {
  return `pledge-${pid}`;
}

export interface PadSetupLinkArgs {
  customerEmail: string;
  customerName: string;
  /** The pid, so a provider-side record can be traced back to one pledge. */
  clientReferenceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export interface PadSetupLink {
  checkoutUrl: string;
  sessionId: string;
  customerId: string | null;
}

/** Call 1 - mint the Stripe-hosted mandate page. */
export async function createPadSetupLink(args: PadSetupLinkArgs): Promise<PadSetupLink> {
  const data = await post('/pad/setup-link', {
    customerEmail: args.customerEmail,
    customerName: args.customerName,
    client_reference_id: args.clientReferenceId,
    branding_settings: {},
    successUrl: args.successUrl,
    cancelUrl: args.cancelUrl,
    metadata: args.metadata,
  });
  const checkoutUrl = typeof data['checkoutUrl'] === 'string' ? data['checkoutUrl'] : null;
  const sessionId = typeof data['sessionId'] === 'string' ? data['sessionId'] : null;
  // A 200 with no url would otherwise send the family to "undefined" right after
  // they chose to give money. Fail loudly instead.
  if (!checkoutUrl || !sessionId) {
    throw new PadClientError('setup-link returned no checkoutUrl/sessionId', 'bad-response');
  }
  return {
    checkoutUrl,
    sessionId,
    customerId: typeof data['customerId'] === 'string' ? data['customerId'] : null,
  };
}

/** Call 3 - did the family actually complete the hosted mandate page? */
export async function getCheckoutSessionResult(sessionId: string): Promise<PadResult> {
  const data = await post('/checkout-session-result', { sessionId });
  return toResult(data['status']);
}

export interface MonthlySubscription {
  subscriptionId: string;
  status: string | null;
  customerId: string | null;
}

/** Call 4 - turn a confirmed mandate into the monthly subscription. Retry-safe. */
export async function createMonthlySubscription(args: {
  setupSessionId: string;
  pid: string;
}): Promise<MonthlySubscription> {
  const priceId = process.env.STRIPE_PLEDGE_PRICE_ID;
  if (!priceId) throw new PadClientError('STRIPE_PLEDGE_PRICE_ID is not set', 'not-configured');
  // Check the rest of the config BEFORE building anything, so a missing base url
  // cannot reach the network with a half-formed request.
  config();

  const data = await post('/pad/monthly-subscription', {
    setupSessionId: args.setupSessionId,
    priceId,
    idempotencyKey: pledgeIdempotencyKey(args.pid),
  });
  const subscriptionId = typeof data['subscriptionId'] === 'string' ? data['subscriptionId'] : null;
  if (!subscriptionId) {
    throw new PadClientError('monthly-subscription returned no subscriptionId', 'bad-response');
  }
  return {
    subscriptionId,
    status: typeof data['status'] === 'string' ? data['status'] : null,
    customerId: typeof data['customerId'] === 'string' ? data['customerId'] : null,
  };
}

/** Call 5 - is that subscription actually live? */
export async function getSubscriptionResult(subscriptionId: string): Promise<PadResult> {
  const data = await post('/subscription-result', { subscriptionId });
  return toResult(data['status']);
}
