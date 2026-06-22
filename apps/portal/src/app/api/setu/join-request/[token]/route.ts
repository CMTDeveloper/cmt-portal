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

  // A manager may only view a request that belongs to their own family.
  if (result.fid !== fid) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
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
