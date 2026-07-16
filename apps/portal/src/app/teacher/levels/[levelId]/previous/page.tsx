import { canTeachLevel } from '@/features/setu/teacher/guard';
import { getLevelPreviousStudentsView } from '@/features/setu/teacher/previous-students-view';
import { mostRecentSunday } from '@/features/setu/calendar/calendar';
import { PreviousStudentsPanel } from '@/features/setu/teacher/components/previous-students-panel';
import { getServerSession } from '@/lib/auth/server-session';

export const metadata = { title: 'Previous students - CMT Teacher' };

export default async function PreviousStudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ levelId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { levelId } = await params;
  const { date: dateParam } = await searchParams;

  const claims = await getServerSession(); // middleware's verified x-portal-* claims
  if (!claims) return <p style={{ color: 'var(--err)', fontSize: 14 }}>Please sign in.</p>;

  const access = await canTeachLevel(claims, levelId);
  if (access === 'level-not-found') return <p style={{ color: 'var(--muted)', fontSize: 14 }}>That class doesn’t exist.</p>;
  if (access === 'forbidden') return <p style={{ color: 'var(--err)', fontSize: 14 }}>You’re not assigned to this class.</p>;

  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : mostRecentSunday();
  const view = await getLevelPreviousStudentsView(levelId, date);
  if (!view) return <p style={{ color: 'var(--muted)', fontSize: 14 }}>That class doesn’t exist.</p>;

  return (
    <PreviousStudentsPanel
      levelId={view.levelId}
      levelName={view.levelName}
      ageLabel={view.ageLabel}
      date={view.date}
      initial={view.students}
    />
  );
}
