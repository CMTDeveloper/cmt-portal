import { NextResponse } from 'next/server';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { getFamilyAssignment } from '@/features/setu/prasad/family-assignment';

/** GET /api/setu/prasad — my family's current prasad assignment (any family role). */
export async function GET(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session?.fid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  const assignment = await getFamilyAssignment(session.fid);
  return NextResponse.json({ assignment }, { status: 200 });
}
