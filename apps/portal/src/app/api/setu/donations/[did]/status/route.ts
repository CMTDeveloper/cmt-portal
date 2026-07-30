import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { isSetuManager, DonationStatusUpdateSchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { markDonationStatus } from '@/features/setu/donations/mark-donation-status';
import { notifyDonationComplete } from '@/features/setu/donations/notify-donation-complete';
import { notifyDonationAbandoned } from '@/features/setu/donations/notify-donation-abandoned';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';

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

  // `.ok`, NOT the result object: markDonationStatus returns a record now, and
  // `if (!result)` on an object is always false - the 404 below would simply
  // have stopped happening, handing a caller `{ok:true}` for another family's
  // donation id. Silent, and exactly the kind of thing a return-type widening
  // does to a boolean call site.
  const { ok, changed } = await markDonationStatus(did, session.fid, parsed.data.status);
  if (!ok) {
    // Unknown did, or it belongs to another family — don't distinguish.
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  // ── This route CONSUMES the transition, so it must also send ──────────────
  // The web pages hang CMT's confirmation / pending emails off `changed`. A
  // mobile client reporting the outcome here wins that same transition, so if
  // this route stayed silent the family would get NO email at all - and no
  // later page render could recover it, because `changed` is false forever
  // after. Mobile payments were entirely mail-less. Found by a Codex review,
  // 2026-07-30.
  //
  // Both notifiers apply their own guards (Bala Vihar enrollment donations
  // only, already-paid families excluded, 7-day cooldown) and never throw, so
  // this cannot fail a status report the client is waiting on.
  if (changed) {
    const cached = await getFamilyByFid(session.fid);
    if (cached) {
      const recipient = {
        members: cached.members,
        currentMid: session.mid,
        managerMids: cached.family.managers ?? [],
      };
      if (parsed.data.status === 'completed') {
        await notifyDonationComplete({ did, fid: session.fid, ...recipient });
      } else if (parsed.data.status === 'abandoned') {
        await notifyDonationAbandoned({
          did,
          fid: session.fid,
          legacyFid: cached.family.legacyFid,
          ...recipient,
        });
      }
    }
  }

  return NextResponse.json({ ok: true, status: parsed.data.status }, { status: 200 });
}
