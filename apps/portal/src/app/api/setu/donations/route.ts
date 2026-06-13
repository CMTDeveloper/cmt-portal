import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { isSetuFamily } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getDonations } from '@/features/setu/donations/get-donations';

/**
 * GET /api/setu/donations — the family's own "donations I started" record,
 * newest first. Any family role may read it (canAccessRoute: GET is family,
 * POST/checkout is manager). Dates serialize to ISO strings. Note: `status`
 * is best-effort (no Stripe webhook) — accounting remains authoritative.
 */
export async function GET(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const session = readSessionFromHeaders(req);
  if (!session || !isSetuFamily(session) || !session.fid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const donations = await getDonations(session.fid);
  return NextResponse.json({ donations }, { status: 200 });
}
