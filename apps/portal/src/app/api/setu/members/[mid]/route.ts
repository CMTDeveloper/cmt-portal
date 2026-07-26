import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { updateMember, deleteMember } from '@/features/setu/members/write-member';

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
  });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = _req.headers.get('x-portal-role');
  const fid = _req.headers.get('x-portal-fid');
  const { mid: targetMid } = await ctx.params;

  if (!role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (role !== 'family-manager') {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

  const result = await deleteMember({ fid, mid: targetMid, actor: null });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
