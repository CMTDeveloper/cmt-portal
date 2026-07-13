import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isTeacher } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeachLevel } from '@/features/setu/teacher/guard';
import { confirmPreviousStudent } from '@/features/setu/teacher/confirm-previous';

const BodySchema = z.object({
  levelId: z.string().min(1),
  mid: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const { levelId, mid, date } = parsed.data;

  const access = await canTeachLevel(session, levelId);
  if (access === 'level-not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (access === 'forbidden') return NextResponse.json({ error: 'not-your-class' }, { status: 403 });

  const result = await confirmPreviousStudent({
    levelId,
    mid,
    date,
    markedByUid: session.uid,
    markedByMid: session.mid,
  });
  if (!result.ok) {
    const status = result.reason === 'level-not-found' ? 404 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true, fid: result.fid });
}
