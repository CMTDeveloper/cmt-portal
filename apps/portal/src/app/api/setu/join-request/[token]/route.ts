import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { getJoinRequestByToken } from '@/features/setu/join-request/get-by-token';

// Manager-only single-request read for the approve page. canAccessRoute already
// gates this path to a Setu manager; the handler additionally enforces that the
// request belongs to the caller's own family (claims.fid).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  const fid = req.headers.get('x-portal-fid');

  if (!role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (role !== 'family-manager') {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

  const { token } = await params;
  const result = await getJoinRequestByToken(token);

  if ('error' in result) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  // A manager may only view a request that belongs to their own family. Return a
  // DISTINCT code (not the bare 'not-found') so a manager signed in as a
  // DIFFERENT family gets a clear "wrong account" message instead of a dead-end
  // "Request not found". Keep the 404 STATUS (not 401/403): the review page is
  // public and its client treats 401/403 as "go sign in" — for an already-
  // signed-in user that would loop through /sign-in. The target family's name is
  // intentionally NOT included (no cross-family info leak).
  if (result.fid !== fid) {
    return NextResponse.json({ error: 'wrong-family' }, { status: 404 });
  }

  return NextResponse.json({
    token: result.token,
    ...(result.requesterName ? { requesterName: result.requesterName } : {}),
    requesterEmail: result.requesterEmail,
    familyName: result.familyName,
    status: result.status,
    expiresAt: result.expiresAt.toISOString(),
  });
}
