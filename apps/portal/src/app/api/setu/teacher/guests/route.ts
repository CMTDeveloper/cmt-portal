import { NextResponse } from 'next/server';
import { MarkGuestSchema, isTeacher } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeachLevel } from '@/features/setu/teacher/guard';
import { markGuest, listGuests } from '@/features/setu/teacher/guests';

// GET ?levelId=&date= — guests marked at a level on a date.
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }
  const url = new URL(req.url);
  const levelId = url.searchParams.get('levelId');
  const date = url.searchParams.get('date');
  if (!levelId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const access = await canTeachLevel(session, levelId);
  if (access === 'level-not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (access === 'forbidden') return NextResponse.json({ error: 'not-your-class' }, { status: 403 });

  return NextResponse.json({ guests: await listGuests(levelId, date) });
}

// POST — mark a visiting student present (isGuest:true) + first-attendance auto-enroll.
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = MarkGuestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const { levelId, date, mid, status } = parsed.data;

  const access = await canTeachLevel(session, levelId);
  if (access === 'level-not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (access === 'forbidden') return NextResponse.json({ error: 'not-your-class' }, { status: 403 });

  const result = await markGuest({ levelId, date, mid, status, markedByUid: session.uid, markedByMid: session.mid });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  return NextResponse.json({ aid: result.aid, autoEnrolled: result.autoEnrolled });
}
