import { NextResponse } from 'next/server';
import { isSetuManager } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';
import { startPledge } from '@/features/setu/pledges/start-pledge';
import { flags } from '@/lib/flags';

/**
 * POST /api/pledges/start - begin a monthly pledge and hand back the
 * Stripe-hosted mandate URL.
 *
 * Deliberately OUTSIDE `/api/setu/*`: that prefix's catch-all grants
 * welcome-team and admin by default (`can-access-route.ts`), and a route that
 * creates a recurring financial commitment must never inherit authorization by
 * accident. `/api/pledges/*` has its own explicit rule.
 *
 * `fid` comes from the SESSION and never from the body - otherwise any manager
 * could start a pledge against another family.
 */
export async function POST(req: Request) {
  // 404, not 403: with the feature dark, the route should look absent rather
  // than merely forbidden.
  if (!flags.setuPledge) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!session.fid) return NextResponse.json({ error: 'no-family' }, { status: 401 });
  // Belt and braces with the middleware rule: canAccessRoute is the gate, this
  // is the in-handler check the repo requires for every privileged route.
  if (!isSetuManager(session)) {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!session.mid) return NextResponse.json({ error: 'no-member' }, { status: 401 });
  if (!session.email) {
    // The hosted page needs somewhere to send the mandate confirmation.
    return NextResponse.json({ error: 'no-email' }, { status: 400 });
  }

  const fam = await getFamilyByFid(session.fid);
  if (!fam) return NextResponse.json({ error: 'family-not-found' }, { status: 404 });

  try {
    const result = await startPledge({
      fid: session.fid,
      mid: session.mid,
      email: session.email,
      name: fam.family.name,
    });
    if (!result.created) {
      // 409, not 200: the caller asked to create something and nothing was
      // created. The UI shows the existing state rather than a new link.
      return NextResponse.json({ error: result.reason, pid: result.pid }, { status: 409 });
    }
    return NextResponse.json({ pid: result.pid, checkoutUrl: result.checkoutUrl }, { status: 201 });
  } catch {
    // The provider error itself is recorded on the pledge doc; never echo it to
    // the client, and never log a body that could carry provider detail.
    return NextResponse.json({ error: 'provider-unavailable' }, { status: 503 });
  }
}
