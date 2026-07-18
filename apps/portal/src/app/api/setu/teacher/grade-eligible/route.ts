import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isTeacher } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeachLevel } from '@/features/setu/teacher/guard';
import { getGradeEligibleUnenrolled } from '@/features/setu/teacher/grade-eligible';
import { markGuest } from '@/features/setu/teacher/guests';

// GET ?levelId= — registered children at the level's location whose grade/age
// matches but who aren't enrolled for its period. Lazily loaded when the teacher
// opens the "Registered · not enrolled" section (a broad location scan).
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }
  const levelId = new URL(req.url).searchParams.get('levelId');
  if (!levelId) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const access = await canTeachLevel(session, levelId);
  if (access === 'level-not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (access === 'forbidden') return NextResponse.json({ error: 'not-your-class' }, { status: 403 });

  const view = await getGradeEligibleUnenrolled(levelId);
  if (!view) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json({ view });
}

const MarkSchema = z.object({
  levelId: z.string().min(1),
  mid: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// POST — mark a registered-but-unenrolled child present. Goes through markGuest,
// the documented first-attendance auto-enroll site, so the child is enrolled for
// the period AND marked present. They then appear on the enrolled roster.
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = MarkSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const { levelId, mid, date } = parsed.data;

  const access = await canTeachLevel(session, levelId);
  if (access === 'level-not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (access === 'forbidden') return NextResponse.json({ error: 'not-your-class' }, { status: 403 });

  const result = await markGuest({
    levelId,
    date,
    mid,
    status: 'present',
    markedByUid: session.uid,
    markedByMid: session.mid,
    // The child is being enrolled AS a roster member, so record a regular (non-
    // guest) attendance event — otherwise buildRoster skips it and they show
    // Unmarked on the enrolled roster until the attendance is re-taken.
    isGuest: false,
  });
  if (!result.ok) {
    const status = result.reason === 'level-not-found' ? 404 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true, autoEnrolled: result.autoEnrolled });
}
