import { NextResponse } from 'next/server';
import { isAdmin, SetMemberGradeBodySchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { setMemberGrade } from '@/features/setu/rollover/set-member-grade';

/**
 * POST /api/admin/school-year/set-grade — set one child's `schoolGrade` to a
 * canonical ladder rung. Admin-only (re-checked here on top of the middleware
 * `/api/admin/` gate). Used by the rollover need-attention inline control and
 * the welcome member detail editor so a "needs-grade" child resolves on the
 * next promotion preview.
 */
export async function POST(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = SetMemberGradeBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error?.issues }, { status: 400 });
  }
  const ok = await setMemberGrade(parsed.data);
  if (!ok) return NextResponse.json({ error: 'member-not-found' }, { status: 404 });
  return NextResponse.json({ ok: true }, { status: 200 });
}
