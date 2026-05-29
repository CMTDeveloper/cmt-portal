import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import type { WithRole } from '@cmt/shared-domain';
import { canTeachLevel } from '@/features/setu/teacher/guard';
import { deriveRoster } from '@/features/setu/teacher/roster';
import { torontoToday } from '@/features/setu/calendar/calendar';
import { AttendanceMarker } from '@/features/setu/teacher/components/attendance-marker';

export const metadata = { title: 'Take attendance — CMT Teacher' };

export default async function TakeAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ levelId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { levelId } = await params;
  const { date: dateParam } = await searchParams;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  const claims = (sessionCookie ? await verifyPortalSessionCookie(sessionCookie) : null) as
    | (WithRole & { mid?: string | null })
    | null;

  if (!claims) {
    return <p style={{ color: 'var(--err)', fontSize: 14 }}>Please sign in.</p>;
  }

  const access = await canTeachLevel(claims, levelId);
  if (access === 'level-not-found') {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>That class doesn’t exist.</p>;
  }
  if (access === 'forbidden') {
    return <p style={{ color: 'var(--err)', fontSize: 14 }}>You’re not assigned to this class.</p>;
  }

  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : torontoToday();
  const roster = await deriveRoster(levelId, date);
  if (!roster) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>That class doesn’t exist.</p>;
  }

  return (
    <AttendanceMarker
      levelId={roster.levelId}
      levelName={roster.levelName}
      ageLabel={roster.ageLabel}
      date={roster.date}
      initialMembers={roster.members}
    />
  );
}
