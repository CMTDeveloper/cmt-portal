import { notFound } from 'next/navigation';
import Link from 'next/link';
import { listClasses } from '@/features/check-in/shared';
import { AttendanceReportTable } from '@/features/check-in/teacher/attendance-report-table';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getRosterForClass } from '@/features/check-in/shared';
import { flags } from '@/lib/flags';
import type { AttendanceStatus, TeacherReportEntry } from '@cmt/shared-domain/check-in';

export const metadata = { title: 'Attendance report' };

interface Props {
  searchParams: Promise<{ classId?: string; from?: string; to?: string }>;
}

export default async function ReportPage({ searchParams }: Props) {
  if (!flags.checkInTeacher) notFound();
  const params = await searchParams;
  const classes = await listClasses();
  const classId = params.classId ?? classes[0]?.classId;

  let entries: TeacherReportEntry[] = [];
  if (classId) {
    try {
      const db = portalFirestore();
      const roster = await getRosterForClass(classId);
      const studentMap = new Map((roster?.students ?? []).map((s) => [s.sid, s]));

      // Attendance is stored at attendance/{date}/{classId}/{sid}.
      // Query date-specific subcollections rather than collectionGroup
      // (which requires a separate index per class name).
      const datesSnap = await db.collection('attendance').listDocuments();
      const dateDocs = datesSnap
        .map((d) => d.id)
        .filter((date) => {
          if (params.from && date < params.from) return false;
          if (params.to && date > params.to) return false;
          return true;
        })
        .sort()
        .reverse();

      for (const date of dateDocs) {
        const snap = await db.collection('attendance').doc(date).collection(classId).get();
        for (const d of snap.docs) {
          const data = d.data() as { date: string; classId: string; sid: string; status: AttendanceStatus };
          const st = studentMap.get(data.sid);
          entries.push({
            date: data.date ?? date,
            classId: data.classId ?? classId,
            sid: data.sid,
            firstName: st?.firstName ?? 'Unknown',
            lastName: st?.lastName ?? '',
            status: data.status,
          });
        }
      }
    } catch (err) {
      console.error('Report query failed:', (err as Error).message);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-6">
      <header className="flex items-start justify-between">
        <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Attendance report</h1>
        <Link href="/check-in/teacher" className="text-sm underline">
          ← Back
        </Link>
      </header>

      <form action="/check-in/teacher/report" method="get" className="flex flex-wrap gap-2">
        <select name="classId" defaultValue={classId} className="rounded border px-2 py-1">
          {classes.map((c) => (
            <option key={c.classId} value={c.classId}>
              {c.name}
            </option>
          ))}
        </select>
        <input name="from" type="date" defaultValue={params.from ?? ''} className="rounded border px-2 py-1" />
        <input name="to" type="date" defaultValue={params.to ?? ''} className="rounded border px-2 py-1" />
        <button type="submit" className="rounded bg-[hsl(var(--primary))] px-3 py-1 text-white">
          Filter
        </button>
      </form>

      {classId && (
        <a
          href={`/api/check-in/teacher/report?classId=${classId}${params.from ? `&from=${params.from}` : ''}${params.to ? `&to=${params.to}` : ''}`}
          className="self-start text-sm underline"
          download
        >
          Download CSV
        </a>
      )}

      <AttendanceReportTable entries={entries} />
    </main>
  );
}
