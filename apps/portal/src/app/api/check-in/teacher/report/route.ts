import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getRosterForClass } from '@/features/check-in/shared';
import { toCsv } from '@/features/check-in/teacher/csv';
import type {
  AttendanceStatus,
  TeacherReportEntry,
  TeacherReportResponse,
} from '@cmt/shared-domain/check-in';


export async function GET(req: Request) {
  const url = new URL(req.url);
  const classId = url.searchParams.get('classId');
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;

  if (!classId) {
    return NextResponse.json({ error: 'classId required' }, { status: 400 });
  }

  let query = portalFirestore()
    .collectionGroup(classId)
    .where('classId', '==', classId);
  if (from) query = query.where('date', '>=', from);
  if (to) query = query.where('date', '<=', to);
  query = query.orderBy('date', 'desc');

  const snap = await query.get();
  const roster = await getRosterForClass(classId);
  const studentMap = new Map((roster?.students ?? []).map((s) => [s.sid, s]));

  const entries: TeacherReportEntry[] = snap.docs.map((d) => {
    const data = d.data() as {
      date: string;
      classId: string;
      sid: string;
      status: AttendanceStatus;
    };
    const student = studentMap.get(data.sid);
    return {
      date: data.date,
      classId: data.classId,
      sid: data.sid,
      firstName: student?.firstName ?? 'Unknown',
      lastName: student?.lastName ?? '',
      status: data.status,
    };
  });

  const accept = req.headers.get('accept') ?? '';
  if (accept.includes('text/csv')) {
    const csv = toCsv(entries);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="attendance-${classId}.csv"`,
      },
    });
  }

  const body: TeacherReportResponse = { entries };
  return NextResponse.json(body, { status: 200 });
}
