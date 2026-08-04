import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import {
  CheckoutInputSchema,
  checkoutLineItemName,
  buildPaymentMetadata,
  processingFeeCAD,
  isSetuManager,
  paymentFamilyLabel,
  paymentSourceOf,
} from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getStripeCheckoutUrl } from '@/lib/stripe-config';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { createDonation } from '@/features/setu/donations/create-donation';
import { BALA_VIHAR } from '@cmt/shared-domain/setu';
import { getFamilyPledge } from '@/features/setu/pledges/get-family-pledge';
import { trustedOriginFromRequest } from '@/lib/portal-base-url';

// In-memory per-IP rate limiter (5/min), same shape as the events-registration
// checkout route. Resets per warm Lambda; acceptable for a low-volume donate flow.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// Anti-phishing: successUrl/cancelUrl are built server-side from a validated
// origin so a tampered client cannot redirect the donor to a malicious site.
//
// ── The allowlist is `isTrustedPortalHost`, NOT a copy of it ────────────────
// This route used to carry its own `PORTAL_VERCEL_PATTERN`, duplicating the one
// in lib/portal-base-url. Two copies of a host allowlist is two things to widen,
// and on 2026-07-30 exactly that bit: a CMT custom domain
// (setu-preview.chinmayatoronto.org) was accepted by NEITHER, so the pledge flow
// returned families to production and this route - which fails closed on an
// unrecognised origin - would have refused the one-time donation outright.
// ── Same precedence as portalBaseUrl: configured base, then the request's own
// host, then nothing ────────────────────────────────────────────────────────
// This used to build a CANDIDATE LIST headed by the caller's `Origin` header and
// tailed by the configured base - so the one input a caller controls outranked
// the one an operator sets. That was survivable while the allowlist was only
// `*.vercel.app`; it stopped being survivable when the list grew to
// `*.chinmayatoronto.org`, because CMT runs other apps there and an `Origin` of
// `https://events.chinmayatoronto.org` would have won over the configured
// production base and sent this portal's Stripe return urls to a sibling app.
//
// Returns null rather than a fallback: unlike the email path, a payment return
// url must never be quietly built from a host we do not recognise, and the
// caller turns null into a 400.
function resolveOrigin(req: Request): string | null {
  const base = process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
  if (base) {
    try {
      return new URL(base).origin;
    } catch {
      // misconfigured env - fall through to the request host
    }
  }
  return trustedOriginFromRequest(req);
}

export async function POST(req: Request) {
  // Hard launch gate — donations stays dark until the full flow is UAT-walked.
  if (!flags.setuDonations) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'too-many-requests' }, { status: 429 });
  }

  const session = readSessionFromHeaders(req);
  if (!session) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isSetuManager(session)) {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!session.fid || !session.mid) {
    return NextResponse.json({ error: 'missing-identity' }, { status: 400 });
  }

  const parsed = CheckoutInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  // Fail closed if the Stripe Cloud Run service isn't configured.
  const checkoutUrl = getStripeCheckoutUrl();
  const apiKey = process.env.STRIPE_API_KEY;
  if (!checkoutUrl || !apiKey) {
    console.error('[donations/checkout] Stripe env not configured');
    return NextResponse.json({ error: 'checkout-not-configured' }, { status: 503 });
  }

  // Load donor (the signed-in manager). customerEmail is taken from the member
  // record, never from a client field.
  const familyData = await getFamilyByFid(session.fid);
  if (!familyData) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }
  const donor = familyData.members.find((m) => m.mid === session.mid);
  if (!donor) {
    return NextResponse.json({ error: 'member-not-found' }, { status: 404 });
  }
  if (!donor.email) {
    return NextResponse.json({ error: 'donor-email-required' }, { status: 400 });
  }
  const donorName = `${donor.firstName} ${donor.lastName}`.trim();

  // Resolve label + oid/eid per donation type, and enforce the snapshot floor
  // for bala-vihar (give more is fine; give less stays welcome-team-only).
  let oid: string | null = null;
  let eid: string | null = null;
  let programKey: string | null = null;
  let programLabel: string | null = null;
  let label: string;
  // `input.type` is the single-member union 'enrollment'; the general branch was
  // removed 2026-08-03 (owner: no general donations exist in the app).

  if (input.type === 'enrollment') {
    const enrollments = await getEnrollments(session.fid);
    const enrollment = enrollments.find((e) => e.eid === input.eid && e.status === 'active');
    if (!enrollment) {
      return NextResponse.json({ error: 'enrollment-not-found' }, { status: 404 });
    }
    if (
      enrollment.offering &&
      paymentSourceOf(enrollment.offering.paymentSource !== undefined ? { paymentSource: enrollment.offering.paymentSource } : {}) === 'teacher-managed'
    ) {
      return NextResponse.json({ error: 'payment-source-teacher-managed' }, { status: 422 });
    }
    if (input.amountCAD < enrollment.effectiveSuggestedAmount) {
      return NextResponse.json(
        { error: 'amount-below-suggested', suggested: enrollment.effectiveSuggestedAmount },
        { status: 422 },
      );
    }
    oid = enrollment.oid;
    eid = enrollment.eid;
    // Derive the program identity from the enrollment's offering so the label +
    // record reflect the ACTUAL program (Bala Vihar, Tabla, …), not a hardcode.
    const pLabel = enrollment.offering?.programLabel ?? enrollment.programLabel;
    const tLabel = enrollment.offering?.termLabel ?? enrollment.termLabel;
    programKey = enrollment.offering?.programKey ?? enrollment.programKey;
    programLabel = pLabel;
    label = checkoutLineItemName('enrollment', { programLabel: pLabel, termLabel: tLabel });

    // ── 🔴 The double-charge guard, and it belongs HERE ────────────────────────
    //
    // A monthly pledge IS the Bala Vihar enrollment donation - $500 once, or $51
    // a month. So a family with a live or confirming pledge must not also be
    // able to pay the one-time amount: they would be debited BOTH, and the
    // portal cannot undo it (there is no cancel endpoint on the payment service,
    // and `cancelPledgeRecord` is bookkeeping only).
    //
    // Three separate SCREENS suppress the payment control for this - the
    // dashboard, the enroll page's DonationChoice, and now the donate page - and
    // one of them was missed for weeks: `/family/donate?eid=` rendered the full
    // form with no pledge awareness at all, reachable from four code paths plus
    // any stale tab. Client-side suppression repeated per surface is a guarantee
    // that decays every time someone adds a fourth surface. This check cannot be
    // routed around, so it is the one that actually holds.
    //
    // `started` counts, not just `active`: a mandate settles in DAYS, and the
    // whole exposure window is exactly that gap. `isPledgeGiving()` is
    // deliberately NOT used - it means `active` alone, which is the precise
    // reason the donate page's existing check let this through.
    //
    // Scoped to Bala Vihar enrollment donations. A GENERAL gift is a different
    // intent and stays open to everyone - a pledging family may still want to
    // give extra, and blocking that would be wrong.
    // Deliberately NOT wrapped in a try/catch, unlike `loadPledgeSlot`, which
    // degrades to null so a Firestore blip costs a card and not a page. Here the
    // failure directions are not symmetric: swallowing the error would treat an
    // unreadable pledge as NO pledge and let the charge through, which is the
    // exact double-debit this prevents. A throw leaves the handler as a 500 -
    // the family retries and nothing is lost. It also adds no new failure mode:
    // `getFamilyByFid` and `getEnrollments` above are unwrapped Firestore reads
    // too, so this route already fails closed on an outage.
    if (programKey === BALA_VIHAR) {
      const pledge = await getFamilyPledge(session.fid);
      if (pledge && (pledge.status === 'started' || pledge.status === 'active')) {
        return NextResponse.json(
          { error: 'pledge-covers-enrollment', pledgeStatus: pledge.status },
          { status: 409 },
        );
      }
    }
  } else {
    // Unreachable today: `type` is the single-member union 'enrollment'. Written
    // as an explicit refusal rather than a definite-assignment assertion on
    // `label`, so if a second donation type is ever added it fails loudly here
    // instead of reaching Stripe with an unset line-item name.
    return NextResponse.json({ error: 'unsupported-donation-type' }, { status: 400 });
  }

  const origin = resolveOrigin(req);
  if (!origin) {
    return NextResponse.json({ error: 'invalid-origin' }, { status: 400 });
  }

  const feeCAD = input.coverFee ? processingFeeCAD(input.amountCAD) : 0;

  // Persist the donation doc first; it owns the client_reference_id, so the
  // Stripe dashboard row maps back to a portal record AND names the family.
  const familyLabel = paymentFamilyLabel({
    fid: session.fid,
    publicFid: familyData.family.publicFid,
  });
  const donation = await createDonation({
    fid: session.fid,
    familyLabel,
    donorMid: session.mid,
    donorName,
    donorEmail: donor.email,
    type: input.type,
    programKey,
    programLabel,
    pid: oid,  // DonationDoc stores 'pid' for the offering id (legacy field name)
    eid,
    label,
    amountCAD: input.amountCAD,
    coverFee: input.coverFee,
    feeCAD,
  });

  const lineItems: Array<{ name: string; amount: number; quantity: number }> = [
    { name: label, amount: input.amountCAD, quantity: 1 },
  ];
  if (feeCAD > 0) {
    lineItems.push({ name: 'Processing Fees', amount: feeCAD, quantity: 1 });
  }

  const payload = {
    lineItems,
    customerEmail: donor.email,
    // The stored value, not a second construction of it: if these two ever
    // disagreed, the donation doc would name a Stripe row that does not exist.
    client_reference_id: donation.clientReferenceId,
    successUrl: `${origin}/donate/success?did=${donation.did}`,
    cancelUrl: `${origin}/family/donate/cancel?did=${donation.did}`,
    // `fid` is the internal document key and stays put - support and any
    // downstream reconciliation match on it. `familyId` is the human-readable
    // one Vaibhav asked for after finding a live record identified only by
    // "CMT-HTNO0TEG"; the two Stripe paths must agree, so the pledge metadata
    // carries the same pair.
    // One helper for both Stripe paths - see buildPaymentMetadata for why
    // `campaign` and `source` are not written inline here. This route used to
    // put the SOURCE ('setu') in the CAMPAIGN field, so on every live payment
    // the campaign was empty and the source was never sent at all.
    metadata: {
      ...buildPaymentMetadata({
        kind: 'donation',
        fid: session.fid,
        familyId: familyLabel,
        programKey,
      }),
      // Kept from before the helper: coarser than programKey, and someone may
      // already be reporting on it.
      category: input.type,
    },
    branding_settings: { display_name: 'Chinmaya Mission Toronto' },
  };

  const resp = await fetch(checkoutUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error('[donations/checkout] Stripe service error:', resp.status, text);
    return NextResponse.json({ error: 'checkout-failed' }, { status: 502 });
  }

  // The Cloud Run service returns { checkoutUrl, sessionId }. Accept `url` too
  // for forward-compat in case the contract changes.
  const data = (await resp.json().catch(() => ({}))) as { checkoutUrl?: string; url?: string };
  const checkoutLink = data.checkoutUrl ?? data.url;
  if (!checkoutLink) {
    console.error('[donations/checkout] Stripe service returned no checkout url');
    return NextResponse.json({ error: 'checkout-failed' }, { status: 502 });
  }

  return NextResponse.json({ url: checkoutLink, did: donation.did }, { status: 200 });
}
