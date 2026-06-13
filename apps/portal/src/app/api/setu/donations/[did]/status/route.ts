import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { isSetuManager, DonationStatusUpdateSchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { markDonationStatus } from '@/features/setu/donations/mark-donation-status';

/**
 * POST /api/setu/donations/{did}/status — the mobile equivalent of the web
 * success/cancel pages. A mobile client opens Stripe checkout in an in-app
 * browser, watches for the portal success/cancel return URL, then reports the
 * outcome here. Manager-only (only a manager initiates checkout, so only a
 * manager reports its result — matches the POST gate on /api/setu/donations/*).
 *
 * markDonationStatus enforces the did-belongs-to-fid guard and never downgrades
 * a 'completed' donation. 'completed' is client-trusted (no Stripe webhook);
 * accounting's settlement notification remains the source of truth.
 */
export async function POST(req: Request, ctx: { params: Promise<{ did: string }> }) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const session = readSessionFromHeaders(req);
  if (!session || !isSetuManager(session) || !session.fid) {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }

  const { did } = await ctx.params;
  if (!did) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const parsed = DonationStatusUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const ok = await markDonationStatus(did, session.fid, parsed.data.status);
  if (!ok) {
    // Unknown did, or it belongs to another family — don't distinguish.
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, status: parsed.data.status }, { status: 200 });
}
