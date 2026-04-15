import { notFound, redirect } from 'next/navigation';
import { getRosterForClass } from '@/features/check-in/shared';
import { AttendanceMarker } from '@/features/check-in/teacher/attendance-marker';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Mark attendance — CMT Portal' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ classId?: string }>;
}

export default async function MarkAttendancePage({ searchParams }: Props) {
  if (!flags.checkInTeacher) notFound();
  const params = await searchParams;
  const classId = params.classId;
  if (!classId) redirect('/check-in/teacher');

  const roster = await getRosterForClass(classId);
  if (!roster) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
      <AttendanceMarker roster={roster} />
    </main>
  );
}
