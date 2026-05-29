import { NextResponse } from 'next/server';
import { SaveAttendanceSchema, isTeacher } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeachLevel } from '@/features/setu/teacher/guard';
import { saveAttendance } from '@/features/setu/teacher/save-attendance';

export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = SaveAttendanceSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const { levelId, date, marks } = parsed.data;

  const access = await canTeachLevel(session, levelId);
  if (access === 'level-not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (access === 'forbidden') return NextResponse.json({ error: 'not-your-class' }, { status: 403 });

  const result = await saveAttendance({
    levelId,
    date,
    marks,
    markedByUid: session.uid,
    markedByMid: session.mid,
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });

  return NextResponse.json({ saved: result.saved, skipped: result.skipped });
}
