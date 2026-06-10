import { NextResponse } from 'next/server';
import { isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { getUpcomingPrasad } from '@/features/setu/prasad/upcoming';

/**
 * GET /api/welcome/prasad/upcoming — the welcome-team day-of view: who is
 * bringing prasad on the next few Sundays per location, with manager contacts.
 * Read-only, welcome-team gated (admin inherits via isWelcomeTeam).
 */
export async function GET(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const result = await getUpcomingPrasad();
  return NextResponse.json(result, { status: 200 });
}
