import { NextResponse } from 'next/server';
import { isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { updateMember, deleteMember, type Actor } from '@/features/setu/members/write-member';

type RouteContext = { params: Promise<{ fid: string; mid: string }> };

/**
 * Staff edit/remove of a member in ANY family.
 *
 * Both handlers delegate to the shared write core, which carries the
 * required-field matrix, the contactKey ownership rules and the last-manager
 * guard - so a staff edit cannot leave a family in a state its own screens
 * would refuse to create.
 */
function authorize(req: Request): Actor | NextResponse {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return { uid: session.uid, mid: session.mid, role: session.role, extraRoles: session.extraRoles };
}

export async function PATCH(req: Request, ctx: RouteContext) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const actor = authorize(req);
  if (actor instanceof NextResponse) return actor;

  // Authority from the session, target from the route. Never mixed.
  const { fid, mid } = await ctx.params;
  const raw = await req.json().catch(() => null);

  const result = await updateMember({
    fid,
    mid,
    body: raw,
    actor,
    // Staff administer families that have locked themselves out, so promoting
    // and demoting managers is the point. The last-manager guard inside the
    // core is what keeps that safe.
    canSetManagerFlag: true,
    // Staff acting on a family they administer. The self-edit concern does not
    // arise here - this route is cross-family by construction (the fid comes
    // from the path, not the session) and every write leaves an audit row
    // naming the actor.
    canSetParticipation: true,
  });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE(req: Request, ctx: RouteContext) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const actor = authorize(req);
  if (actor instanceof NextResponse) return actor;

  const { fid, mid } = await ctx.params;

  const result = await deleteMember({ fid, mid, actor });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
