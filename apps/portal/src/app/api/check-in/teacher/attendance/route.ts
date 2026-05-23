import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { ATTENDANCE_STATUSES, type TeacherAttendanceResponse } from '@cmt/shared-domain/check-in';


const statusEnum = z.enum(ATTENDANCE_STATUSES);
const bodySchema = z.object({
  classId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statuses: z.record(z.string(), statusEnum),
});

export async function POST(req: Request) {
  const uid = req.headers.get('x-portal-uid');
  if (!uid) return NextResponse.json({ error: 'no-uid' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { classId, date, statuses } = parsed.data;
  const db = portalFirestore();
  const markedAt = new Date().toISOString();

  let recorded = 0;
  for (const [sid, status] of Object.entries(statuses)) {
    await db
      .collection('attendance')
      .doc(date)
      .collection(classId)
      .doc(sid)
      .set({
        date,
        classId,
        sid,
        status,
        markedAt,
        markedByUid: uid,
      });
    recorded += 1;
  }

  const body: TeacherAttendanceResponse = { success: true, recorded };
  return NextResponse.json(body, { status: 200 });
}
