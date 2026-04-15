import { notFound } from 'next/navigation';
import Link from 'next/link';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { listClasses, getRosterForClass } from '@/features/check-in/shared';
import { AttendanceReportTable } from '@/features/check-in/teacher/attendance-report-table';
import { flags } from '@/lib/flags';
import type { AttendanceStatus, TeacherReportEntry } from '@cmt/shared-domain/check-in';

export const metadata = { title: 'Uninformed absentees — CMT Portal' };
export const dynamic = 'force-dynamic';

export default async function UninformedPage() {
  if (!flags.checkInTeacher) notFound();

  const classes = await listClasses();
  const entries: TeacherReportEntry[] = [];
  for (const c of classes) {
    const snap = await portalFirestore()
      .collectionGroup(c.classId)
      .where('classId', '==', c.classId)
      .where('status', '==', 'uninformed')
      .orderBy('date', 'desc')
      .get();
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

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 p-6">
      <header className="flex items-start justify-between">
        <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Uninformed absentees</h1>
        <Link href="/check-in/teacher" className="text-sm underline">
          ← Back
        </Link>
      </header>
      <AttendanceReportTable entries={entries} />
    </main>
  );
}
