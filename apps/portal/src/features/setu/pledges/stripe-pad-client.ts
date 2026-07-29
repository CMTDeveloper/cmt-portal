import 'server-only';
import { ORG_NAME } from '@/lib/branding';

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
    // Carry the provider's OWN words, not just the status. A bare
    // "failed with 400" is what turned a one-line payload bug (a missing
    // `branding_settings.display_name`) into a live debugging session: the
    // service had named the offending field and this line discarded it, so the
    // pledge doc's `lastError` said only "400". Truncated because it lands in a
    // Firestore field, and best-effort because a body we cannot read must never
    // replace the status we can.
    const detail = await res
      .text()
      .then((t) => t.trim().slice(0, 300))
      .catch(() => '');
    throw new PadClientError(
      detail ? `${path} failed with ${res.status}: ${detail}` : `${path} failed with ${res.status}`,
      'http',
      res.status,
    );
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/**
 * Normalise a provider outcome from a step 3 / step 5 response body.
 *
 * ── The field is `state`, not `status` ──────────────────────────────────────
 * The spec documented these calls as returning bare `success | failed |
 * pending` and never named the field carrying it; this client guessed
 * `status`, and the service answers `state`:
 *
 *   {"state":"success","reason":"PAD mandate setup completed",
 *    "stripe":{"status":"complete","setup_intent_status":"succeeded", …}}
 *
 * The mismatch was SILENT rather than loud, because an unreadable answer maps
 * to `pending` (below) - so step 3 reported `pending` for a mandate Stripe had
 * already marked `succeeded`, `advancePledge` never proceeded to step 4, and no
 * pledge could reach `active`. It presented as a sandbox that never settled.
 *
 * Both names are accepted. The two endpoints were never proven to agree with
 * each other, and a second wrong guess costs another silent stall - whereas
 * accepting a name the service does not send costs nothing.
 *
 * ⚠️ Read ONLY the top level. `stripe.status` is the Checkout Session's own
 * lifecycle - `complete` merely means the family finished the page, which is
 * equally true of a mandate that FAILED. Reading it would turn a failure into
 * a success, the one direction that must never happen.
 *
 * Anything unrecognised - a new value, a typo, a missing field - becomes
 * `pending`, NEVER `success`. The two failure directions are not symmetric:
 * reading an unknown answer as success marks a family as giving when no
 * subscription is confirmed, while reading it as pending simply leaves the
 * pledge for the reconciler to resolve.
 */
function toResult(body: Record<string, unknown>): PadResult {
  const raw = body['state'] ?? body['status'];
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
    // REQUIRED by the payment service - an empty object is rejected with
    // `400 Invalid branding_settings.display_name`, which failed every pledge
    // before the family reached Stripe. It is also the name the family reads on
    // the hosted mandate page while authorising a recurring debit, so it must be
    // the charity's, and it matches what the one-time donation route sends.
    branding_settings: { display_name: ORG_NAME },
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
  return toResult(data);
}

/**
 * Was the hosted page ever SUBMITTED? A narrower question than `PadResult`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `state` collapses two very different situations into `pending`: "the family
 * authorised a mandate and the bank is confirming it" and "the family opened the
 * page and walked away". Vaibhav, 2026-07-28: *"didn't even complete PAD
 * process. I clicked and backed out from stripe page."* Probing the service for
 * that exact session returned
 *   {"state":"pending","reason":"PAD setup not completed yet",
 *    "stripe":{"mode":"setup","status":"open"}}
 * so the pledge sat `started` forever, every payment surface refused the family,
 * and `/api/pledges/start` answered 409 `already-started`. A dead end.
 *
 * ── Why reading nested `stripe.status` is safe HERE and nowhere else ────────
 * 🔴 It is NOT safe for judging SUCCESS - `complete` is set even for a mandate
 * that later FAILS, which is precisely why `toResult` reads the top-level
 * `state`. This function asks a different question: *was anything submitted at
 * all?* Stripe's Checkout Session status answers exactly that, and only that:
 *   open     - never submitted; no mandate can exist
 *   expired  - never submitted, and now unusable
 *   complete - submitted; a mandate may well exist
 * Do not widen this to infer success. It has one job.
 *
 * FAILS CLOSED: anything unrecognised is `submitted`, because the cost of a
 * wrong `not-submitted` is a family authorising a SECOND bank mandate.
 */
export type SessionSubmission = 'not-submitted' | 'submitted';

export async function getCheckoutSessionSubmission(sessionId: string): Promise<SessionSubmission> {
  const data = await post('/checkout-session-result', { sessionId });
  const stripe = data['stripe'];
  const status =
    stripe !== null && typeof stripe === 'object'
      ? (stripe as Record<string, unknown>)['status']
      : undefined;
  return status === 'open' || status === 'expired' ? 'not-submitted' : 'submitted';
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
  return toResult(data);
}
