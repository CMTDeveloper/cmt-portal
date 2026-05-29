import { NextResponse } from 'next/server';
import { isTeacher } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeachLevel } from '@/features/setu/teacher/guard';
import { deriveRoster } from '@/features/setu/teacher/roster';
import { torontoToday } from '@/features/setu/calendar/calendar';

export async function GET(req: Request, { params }: { params: Promise<{ levelId: string }> }) {
  const session = readSessionFromHeaders(req);
  if (!session || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }

  const { levelId } = await params;
  const access = await canTeachLevel(session, levelId);
  if (access === 'level-not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (access === 'forbidden') return NextResponse.json({ error: 'not-your-class' }, { status: 403 });

  const date = new URL(req.url).searchParams.get('date') || torontoToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'bad-date' }, { status: 400 });
  }

  const roster = await deriveRoster(levelId, date);
  if (!roster) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json({ roster });
}
