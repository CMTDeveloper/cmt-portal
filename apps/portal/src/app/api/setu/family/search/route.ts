import { NextResponse } from 'next/server';
import { isWelcomeTeam, ROLES, type Role } from '@cmt/shared-domain';
import { flags } from '@/lib/flags';
import { searchFamilies } from '@/features/setu/search/search-families';


export async function GET(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  if (!role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  // Multi-role: a family-manager with extraRoles=['admin'] should pass —
  // isWelcomeTeam() honors role + extras AND admin inherits welcome-team
  // capability. Reading the comma-separated x-portal-extra-roles header
  // set by middleware avoids a second session-verify round-trip.
  const extrasHeader = req.headers.get('x-portal-extra-roles') ?? '';
  const extraRoles = extrasHeader
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Role => (ROLES as readonly string[]).includes(s));
  if (!isWelcomeTeam({ role: role as Role, extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();

  if (!q) {
    return NextResponse.json({ hits: [] }, { status: 200 });
  }

  const hits = await searchFamilies(q);
  return NextResponse.json({ hits }, { status: 200 });
}
