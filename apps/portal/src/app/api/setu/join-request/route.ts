import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { listPendingJoinRequests } from '@/features/setu/join-request/list-requests';

// Manager-only list of OPEN (pending) join-requests for the caller's own
// family. Relies on the /api/setu/ catch-all (manager-only) for routing; the
// handler additionally enforces the manager role + reads claims.fid.
export async function GET(req: Request) {
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

  const requests = await listPendingJoinRequests(fid);
  return NextResponse.json({ requests }, { status: 200 });
}
