import { NextResponse } from 'next/server';
import { PrasadConfirmBodySchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { confirmAssignment } from '@/features/setu/prasad/family-assignment';

/**
 * POST /api/setu/prasad/confirm — family confirms their PROPOSED Sunday, either
 * in place (no body date) or at another open Sunday. Manager-only at the
 * middleware gate; the transaction re-validates status + target capacity.
 */
export async function POST(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session?.fid) return NextResponse.json({ error: 'no-session' }, { status: 401 });

  const parsed = PrasadConfirmBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error?.issues }, { status: 400 });
  }

  const result = await confirmAssignment(session.fid, parsed.data.date, session.mid ?? 'manager');
  if (result === 'confirmed') return NextResponse.json({ ok: true }, { status: 200 });
  if (result === 'not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json({ error: result }, { status: 409 });
}
