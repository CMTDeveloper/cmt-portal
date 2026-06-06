import { NextResponse } from 'next/server';
import { isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getOpportunityRoster } from '@/features/setu/seva/get-opportunity-roster';

type RouteContext = { params: Promise<{ oppId: string }> };

export async function GET(req: Request, ctx: RouteContext) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { oppId } = await ctx.params;
  const roster = await getOpportunityRoster(oppId);
  if (!roster) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json(roster);
}
