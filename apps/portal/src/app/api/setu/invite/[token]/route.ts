import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { getInviteByToken } from '@/features/setu/invite/get-invite';


export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const { token } = await params;
  const result = await getInviteByToken(token);

  if ('error' in result) {
    if (result.error === 'not-found') {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    if (result.error === 'expired') {
      return NextResponse.json({ error: 'expired' }, { status: 410 });
    }
    if (result.error === 'accepted') {
      return NextResponse.json({ error: 'already-accepted' }, { status: 409 });
    }
  }

  if ('token' in result) {
    return NextResponse.json({
      familyName: result.familyName,
      inviterName: result.inviterName,
      relation: result.relation,
      expiresAt: result.expiresAt.toISOString(),
    });
  }

  return NextResponse.json({ error: 'not-found' }, { status: 404 });
}
