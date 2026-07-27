import { NextResponse } from 'next/server';
import { isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { cancelPledgeRecord } from '@/features/setu/pledges/cancel-pledge';
import { flags } from '@/lib/flags';

/**
 * POST /api/admin/pledges/[pid]/cancel - mark a pledge cancelled in the
 * portal's records. BOOKKEEPING ONLY: this does not stop the debit.
 *
 * No new `canAccessRoute` clause is needed - the existing `/api/admin/`
 * admin-only catch-all already gates this at the middleware layer. The
 * in-handler `isAdmin` is the defensive re-check every privileged route in this
 * repo carries, and it is helper-based so it honours extraRoles.
 */
export async function POST(req: Request, ctx: { params: Promise<{ pid: string }> }) {
  // 404, not 403, with the feature dark - the route should look absent.
  if (!flags.setuPledge) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  // An admin session always carries a uid; refusing without one is not defence
  // against a real caller but against writing an audit row that names nobody.
  // The row is the entire justification for allowing this action at all.
  if (!session.uid) return NextResponse.json({ error: 'no-actor' }, { status: 401 });

  const { pid } = await ctx.params;
  if (!pid) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const result = await cancelPledgeRecord({
    pid,
    actor: {
      uid: session.uid,
      mid: session.mid ?? null,
      role: session.role,
      // Load-bearing: a welcome-team volunteer who is also an admin would
      // otherwise be recorded under one role only.
      extraRoles: session.extraRoles ?? [],
    },
  });

  if (result.ok) return NextResponse.json({ ok: true }, { status: 200 });
  if (result.reason === 'not-found') {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  // 409: the caller asked for a state change that did not happen. Distinct from
  // 404 so the screen can say "already cancelled" rather than "no such pledge".
  return NextResponse.json({ error: result.reason }, { status: 409 });
}
