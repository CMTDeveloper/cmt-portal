import { NextResponse } from 'next/server';
import { AddStudentSchema, isTeacher } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeachLevel } from '@/features/setu/teacher/guard';
import { addStudentOnPrompt } from '@/features/setu/teacher/add-student';

// A teacher adds an unregistered child on the spot → pending family (parent
// claims via email contactKey) + guest-mark present + first-attendance enroll.
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = AddStudentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  const access = await canTeachLevel(session, data.levelId);
  if (access === 'level-not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (access === 'forbidden') return NextResponse.json({ error: 'not-your-class' }, { status: 403 });

  const result = await addStudentOnPrompt({
    levelId: data.levelId,
    date: data.date,
    firstName: data.firstName,
    lastName: data.lastName,
    schoolGrade: data.schoolGrade,
    gender: data.gender,
    parentEmail: data.parentEmail,
    parentPhone: data.parentPhone,
    markedByUid: session.uid,
    markedByMid: session.mid,
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });

  return NextResponse.json({
    fid: result.fid,
    childMid: result.childMid,
    createdFamily: result.createdFamily,
    autoEnrolled: result.autoEnrolled,
  });
}
