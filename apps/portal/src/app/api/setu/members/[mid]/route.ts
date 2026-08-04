import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { updateMember } from '@/features/setu/members/write-member';

type RouteContext = { params: Promise<{ mid: string }> };

/**
 * Family self-serve: edit or remove a member of your OWN family.
 *
 * The write itself (required-field matrix, contactKey ownership rules, the
 * last-manager guard, session revocation) lives in
 * `features/setu/members/write-member.ts` so the staff cross-family routes run
 * the identical logic. Only the access decision stays here, and `actor: null`
 * marks these as family writes, which produce no audit row.
 */
export async function PATCH(req: Request, ctx: RouteContext) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  const fid = req.headers.get('x-portal-fid');
  const callerMid = req.headers.get('x-portal-mid');
  const { mid: targetMid } = await ctx.params;

  if (!role || !callerMid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

  const isManager = role === 'family-manager';
  const isSelfEdit = callerMid === targetMid;

  // Non-managers can only edit themselves
  if (!isManager && !isSelfEdit) {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const result = await updateMember({
    fid,
    mid: targetMid,
    body: raw,
    actor: null,
    // Only a manager may grant or revoke manager access; a member editing their
    // own record may not promote themselves.
    canSetManagerFlag: isManager,
    // Nobody sets their OWN participation. A non-manager can only reach their
    // own record anyway (the 403 above), so the one case this refuses is the
    // self-edit - which is exactly the one both UIs already decline to offer,
    // and the one that would let someone excuse themselves from the profile
    // gate while keeping every privilege their session grants.
    canSetParticipation: isManager && !isSelfEdit,
  });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

/**
 * CLOSED 2026-08-04. A family cannot remove one of its own members.
 *
 * Vaibhav: *"we do not want families to remove any members. At the very least,
 * they can only disable."* Withdrawing the button was not enough - a rule that
 * lives only in a component is not a rule, and this handler was still accepting
 * any family-manager session that reached it (a devtools call, a bookmarked
 * flow, the mobile app, or the next UI regression).
 *
 * It was also the WORST path to leave open: it called `deleteMember` with
 * `actor: null`, so a family delete wrote no audit row at all. Every remaining
 * delete goes through `DELETE /api/welcome/families/{fid}/members/{mid}`, which
 * is admin-only and always names who did it.
 *
 * Kept as an explicit 403 rather than deleted outright: a 405 or a 404 tells a
 * caller nothing, and the mobile app mirrors these routes by hand. A stable
 * error code is how it learns this is deliberate. Families keep the reversible
 * answer - PATCH this same member with `{ participation: 'inactive' }`.
 */
export async function DELETE(_req: Request, _ctx: RouteContext) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  return NextResponse.json(
    { error: 'families-cannot-remove-members', hint: 'Set participation to inactive instead.' },
    { status: 403 },
  );
}
