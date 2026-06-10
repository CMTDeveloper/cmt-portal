import { NextResponse } from 'next/server';
import { PrasadMoveBodySchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { moveAssignment } from '@/features/setu/prasad/family-assignment';

/**
 * POST /api/setu/prasad/move — family self-service move to a future class Sunday.
 * Manager-only at the middleware (canAccessRoute) gate; the feature re-validates
 * the move lock + target capacity inside a transaction.
 */
export async function POST(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session?.fid) return NextResponse.json({ error: 'no-session' }, { status: 401 });

  const parsed = PrasadMoveBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error?.issues }, { status: 400 });
  }

  const result = await moveAssignment(session.fid, parsed.data.date, session.mid ?? 'manager');
  if (result === 'moved') return NextResponse.json({ ok: true }, { status: 200 });
  if (result === 'not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json({ error: result }, { status: 409 });
}
