import { NextResponse } from 'next/server';
import { isTeacher, AwardAchievementSchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeacherSeeStudent } from '@/features/setu/teacher/student-detail';
import { awardAchievement } from '@/features/setu/teacher/award-achievement';
import { fidFromMid } from '@/features/setu/members/mid';

export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = AwardAchievementSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });

  const { mid, title } = parsed.data;
  if (!(await canTeacherSeeStudent(session, mid))) {
    return NextResponse.json({ error: 'not-your-student' }, { status: 403 });
  }
  const { achId } = await awardAchievement({
    fid: fidFromMid(mid),
    mid,
    title,
    description: parsed.data.description ?? null,
    programKey: parsed.data.programKey ?? null,
    awardedByUid: session.uid,
    awardedByName: null,
  });
  return NextResponse.json({ achId }, { status: 201 });
}
