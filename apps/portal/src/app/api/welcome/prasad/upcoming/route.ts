import { NextResponse } from 'next/server';
import { isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { getUpcomingPrasad } from '@/features/setu/prasad/upcoming';

/**
 * GET /api/welcome/prasad/upcoming — the day-of view: who is bringing prasad on
 * the next few Sundays per location, with manager contacts. Read-only, and
 * ADMIN-ONLY since the 2026-08-03 narrowing (it used to say welcome-team).
 */
export async function GET(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  // isAdmin, NOT isWelcomeTeam. Middleware already restricts this path to
  // admins (can-access-route.ts), and this in-handler check was left behind at
  // the 2026-08-03 narrowing - gate 1 moved, gate 3 did not. It is unreachable
  // today, which is exactly why it is worth closing: it is a trap primed to
  // fire the moment the middleware rule is loosened, and since 2026-08-05
  // isWelcomeTeam() also answers true for a coordinator, so the blast radius
  // had silently grown.
  //
  // (This comment shipped garbled - "isAdmin, NOT isAdmin", and crediting
  // isAdmin with coordinator inheritance, which is isWelcomeTeam's. A blanket
  // find-and-replace across the file rewrote the words inside the prose it was
  // explaining. Caught in review.)
  if (!isAdmin({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const result = await getUpcomingPrasad();
  return NextResponse.json(result, { status: 200 });
}
