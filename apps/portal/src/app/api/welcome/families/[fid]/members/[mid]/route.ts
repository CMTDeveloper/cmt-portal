import { NextResponse } from 'next/server';
import { isAdmin, isWelcomeTeam } from '@cmt/shared-domain';
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
 *
 * `requireAdmin` exists because the two handlers below do NOT carry the same
 * authority: staff correct a grade, only an admin deletes a person. It is a
 * parameter rather than a second copy of this function so the session is read
 * in exactly one place and neither handler can be given the wrong rule by
 * being edited on its own.
 */
function authorize(req: Request, opts: { requireAdmin: boolean }): Actor | NextResponse {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  const claims = { role: session.role, extraRoles: session.extraRoles };
  if (!isWelcomeTeam(claims)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (opts.requireAdmin && !isAdmin(claims)) {
    return NextResponse.json({ error: 'admin-required' }, { status: 403 });
  }
  return { uid: session.uid, mid: session.mid, role: session.role, extraRoles: session.extraRoles };
}

export async function PATCH(req: Request, ctx: RouteContext) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const actor = authorize(req, { requireAdmin: false });
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

/**
 * Remove a member of any family. **ADMIN ONLY** - stricter than the PATCH above.
 *
 * The welcome-team grant is "roster + visitors, and nothing else" (2026-08-03,
 * Vaibhav), and permanently deleting a person with their attendance history is
 * neither. PATCH stays welcome-team because correcting a child's grade IS
 * roster work and is reversible; this is not.
 *
 * The gate is here, in the handler, and not only on the control that calls it:
 * the button is rendered for admins on `/welcome/family/[fid]/members/[mid]`,
 * but a control that declines to render has never stopped a request. Same
 * lesson `participation` taught when both screens refused to offer it and the
 * route accepted it anyway.
 */
export async function DELETE(req: Request, ctx: RouteContext) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const actor = authorize(req, { requireAdmin: true });
  if (actor instanceof NextResponse) return actor;

  const { fid, mid } = await ctx.params;

  const result = await deleteMember({ fid, mid, actor });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
