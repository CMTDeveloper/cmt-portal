import { NextResponse } from 'next/server';
import { isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSevaCompliance } from '@/features/setu/seva/get-seva-compliance';

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const compliance = await getSevaCompliance();
  return NextResponse.json(compliance);
}
