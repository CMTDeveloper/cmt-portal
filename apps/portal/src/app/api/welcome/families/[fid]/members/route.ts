import { NextResponse } from 'next/server';
import { isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { addMember } from '@/features/setu/members/write-member';

type RouteContext = { params: Promise<{ fid: string }> };

/**
 * Staff add-a-member, to ANY family.
 *
 * Authority comes from the session; the target family comes from the route
 * param. They are never mixed - a handler that took `fid` from the session
 * would silently write the staff member's own family.
 *
 * `canAccessRoute` already gates the whole `/api/welcome/families/` prefix on
 * `isWelcomeTeam` (which inherits admin, and deliberately does NOT inherit
 * coordinator - spec 3.1 grants coordinator family READ but not EDIT). The
 * check here is the second of the three gates, not a duplicate: middleware
 * rules and handlers drift, and this is the one that stops a mistake in the
 * former from becoming a data leak.
 *
 * The `flags.setuAuth` guard matches the directory sibling
 * (`families/migration-status/route.ts`). The seva routes under /api/welcome
 * omit it; family data is the more sensitive surface, so it keeps the guard.
 */
export async function POST(req: Request, ctx: RouteContext) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  // `uid` is `string | null` on PortalSessionHeaders because family routes
  // authenticate via fid. Actor.uid is `string`, so this null check is
  // load-bearing rather than defensive.
  if (!session || !session.uid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { fid } = await ctx.params;
  const raw = await req.json().catch(() => null);

  // Validation, the required-field matrix and the write all live in the shared
  // core, so a staff-created member can never be shaped differently from a
  // family-created one.
  const result = await addMember({
    fid,
    body: raw,
    actor: { uid: session.uid, mid: session.mid, role: session.role, extraRoles: session.extraRoles },
  });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json({ mid: result.mid }, { status: 201 });
}
