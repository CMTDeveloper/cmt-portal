import { NextResponse } from 'next/server';
import { isSetuFamily, isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getChildProfile } from '@/features/setu/members/get-child-profile';

type RouteContext = { params: Promise<{ mid: string }> };

export async function GET(req: Request, ctx: RouteContext) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });

  const { mid } = await ctx.params;
  const profile = await getChildProfile(mid);
  if (!profile) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  // Welcome/admin may read any family's child; a setu family only its own.
  const allowed = isWelcomeTeam(session) || (isSetuFamily(session) && profile.fid === session.fid);
  if (!allowed) return NextResponse.json({ error: 'not-found' }, { status: 404 }); // don't leak existence

  return NextResponse.json({ profile });
}
