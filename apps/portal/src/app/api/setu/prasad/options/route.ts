import { NextResponse } from 'next/server';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { getMoveOptions } from '@/features/setu/prasad/family-assignment';

/** GET /api/setu/prasad/options — future class Sundays I can move to (any family role). */
export async function GET(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session?.fid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  const result = await getMoveOptions(session.fid);
  return NextResponse.json(result ?? { paid: null, options: [] }, { status: 200 });
}
