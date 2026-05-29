import { NextResponse } from 'next/server';
import { isTeacher } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeacherSeeStudent, getStudentDetail } from '@/features/setu/teacher/student-detail';

export async function GET(req: Request, { params }: { params: Promise<{ mid: string }> }) {
  const session = readSessionFromHeaders(req);
  if (!session || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }

  const { mid } = await params;
  if (!(await canTeacherSeeStudent(session, mid))) {
    return NextResponse.json({ error: 'not-your-student' }, { status: 403 });
  }

  const detail = await getStudentDetail(mid);
  if (!detail) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json({ student: detail });
}
