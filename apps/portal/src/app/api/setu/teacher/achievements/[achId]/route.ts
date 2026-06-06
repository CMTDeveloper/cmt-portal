import { NextResponse } from 'next/server';
import { isTeacher } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeacherSeeStudent } from '@/features/setu/teacher/student-detail';
import { revokeAchievement } from '@/features/setu/teacher/award-achievement';
import { fidFromMid } from '@/features/setu/members/mid';

type RouteContext = { params: Promise<{ achId: string }> };

export async function DELETE(req: Request, ctx: RouteContext) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }
  const { achId } = await ctx.params;
  const mid = new URL(req.url).searchParams.get('mid');
  if (!mid) return NextResponse.json({ error: 'mid-required' }, { status: 400 });
  if (!(await canTeacherSeeStudent(session, mid))) {
    return NextResponse.json({ error: 'not-your-student' }, { status: 403 });
  }
  const ok = await revokeAchievement(fidFromMid(mid), mid, achId);
  if (!ok) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json({ ok: true }, { status: 200 });
}
