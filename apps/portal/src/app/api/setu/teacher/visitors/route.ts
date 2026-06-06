import { NextResponse } from 'next/server';
import { AddVisitorSchema, isTeacher } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeachLevel } from '@/features/setu/teacher/guard';
import { getLevelVisitorsView, addVisitorOnPrompt } from '@/features/setu/teacher/visitors';

// GET ?levelId=&date= — door guests matched to the level + confirmed guests.
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

  const view = await getLevelVisitorsView(levelId, date);
  if (!view) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json({ view });
}

// POST — confirm a door guest / add a walk-in: pending family + guest mark.
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = AddVisitorSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  const access = await canTeachLevel(session, data.levelId);
  if (access === 'level-not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (access === 'forbidden') return NextResponse.json({ error: 'not-your-class' }, { status: 403 });

  const result = await addVisitorOnPrompt({
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
    claimable: result.claimable,
  });
}
