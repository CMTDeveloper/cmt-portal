import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import {
  CheckoutInputSchema,
  checkoutLineItemName,
  processingFeeCAD,
  isSetuManager,
} from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getStripeCheckoutUrl } from '@/lib/stripe-config';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { createDonation } from '@/features/setu/donations/create-donation';

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

// The portal is deployed at cmt-setu.vercel.app (and preview deploys like
// cmt-setu-git-<branch>.vercel.app). cmt-portal* is kept for the older alias.
// A custom production domain should be set via NEXT_PUBLIC_PORTAL_BASE_URL,
// which is also accepted below.
const PORTAL_VERCEL_PATTERN = /^https:\/\/cmt-(setu|portal)[a-z0-9-]*\.vercel\.app$/;

// Anti-phishing: successUrl/cancelUrl are built server-side from a validated
// origin so a tampered client cannot redirect the donor to a malicious site.
function resolveOrigin(req: Request): string | null {
  const base = process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
  const candidates: string[] = [];
  const origin = req.headers.get('origin');
  if (origin) candidates.push(origin);
  const xfh = req.headers.get('x-forwarded-host');
  if (xfh) candidates.push(`${req.headers.get('x-forwarded-proto') ?? 'https'}://${xfh}`);
  const host = req.headers.get('host');
  if (host) candidates.push(`http://${host}`);
  if (base) candidates.push(base);

  for (const c of candidates) {
    try {
      const u = new URL(c);
      const baseOrigin = base ? new URL(base).origin : null;
      if (
        u.hostname === 'localhost' ||
        PORTAL_VERCEL_PATTERN.test(u.origin) ||
        (baseOrigin !== null && u.origin === baseOrigin)
      ) {
        return u.origin;
      }
    } catch {
      // skip unparseable candidate
    }
  }
  return null;
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

  // Resolve label + pid/eid per donation type, and enforce the snapshot floor
  // for bala-vihar (give more is fine; give less stays welcome-team-only).
  let pid: string | null = null;
  let eid: string | null = null;
  let label: string;

  if (input.type === 'bala-vihar') {
    const enrollments = await getEnrollments(session.fid);
    const enrollment = enrollments.find((e) => e.eid === input.eid && e.status === 'active');
    if (!enrollment) {
      return NextResponse.json({ error: 'enrollment-not-found' }, { status: 404 });
    }
    if (input.amountCAD < enrollment.effectiveSuggestedAmount) {
      return NextResponse.json(
        { error: 'amount-below-suggested', suggested: enrollment.effectiveSuggestedAmount },
        { status: 422 },
      );
    }
    pid = enrollment.pid;
    eid = enrollment.eid;
    label = checkoutLineItemName('bala-vihar', enrollment.period?.periodLabel);
  } else {
    label = checkoutLineItemName('general');
  }

  const origin = resolveOrigin(req);
  if (!origin) {
    return NextResponse.json({ error: 'invalid-origin' }, { status: 400 });
  }

  const feeCAD = input.coverFee ? processingFeeCAD(input.amountCAD) : 0;

  // Persist the donation doc first; its id is our client_reference_id so the
  // Stripe dashboard row maps back to a portal record.
  const donation = await createDonation({
    fid: session.fid,
    donorMid: session.mid,
    donorName,
    donorEmail: donor.email,
    type: input.type,
    pid,
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
    client_reference_id: donation.did,
    successUrl: `${origin}/family/donate/success?did=${donation.did}`,
    cancelUrl: `${origin}/family/donate/cancel?did=${donation.did}`,
    metadata: { campaign: 'setu', category: input.type, fid: session.fid },
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
