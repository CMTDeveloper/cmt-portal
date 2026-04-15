import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { listClasses, getRosterForClass } from '@/features/check-in/shared';
import type {
  AttendanceStatus,
  TeacherReportEntry,
  TeacherUninformedResponse,
} from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;

  const classes = await listClasses();
  const entries: TeacherReportEntry[] = [];

  for (const c of classes) {
    let q = portalFirestore()
      .collectionGroup(c.classId)
      .where('classId', '==', c.classId)
      .where('status', '==', 'uninformed');
    if (from) q = q.where('date', '>=', from);
    if (to) q = q.where('date', '<=', to);
    q = q.orderBy('date', 'desc');

    const snap = await q.get();
    const roster = await getRosterForClass(c.classId);
    const studentMap = new Map((roster?.students ?? []).map((s) => [s.sid, s]));

    for (const doc of snap.docs) {
      const data = doc.data() as { date: string; classId: string; sid: string; status: AttendanceStatus };
      const st = studentMap.get(data.sid);
      entries.push({
        date: data.date,
        classId: data.classId,
        sid: data.sid,
        firstName: st?.firstName ?? 'Unknown',
        lastName: st?.lastName ?? '',
        status: data.status,
      });
    }
  }

  const body: TeacherUninformedResponse = { entries };
  return NextResponse.json(body, { status: 200 });
}
