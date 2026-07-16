import { canTeachLevel } from '@/features/setu/teacher/guard';
import { getLevelVisitorsView } from '@/features/setu/teacher/visitors';
import { mostRecentSunday } from '@/features/setu/calendar/calendar';
import { VisitorsPanel } from '@/features/setu/teacher/components/visitors-panel';
import { getServerSession } from '@/lib/auth/server-session';

export const metadata = { title: 'Visitors — CMT Teacher' };

export default async function VisitorsPage({
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
  const view = await getLevelVisitorsView(levelId, date);
  if (!view) return <p style={{ color: 'var(--muted)', fontSize: 14 }}>That class doesn’t exist.</p>;

  return <VisitorsPanel levelId={view.levelId} levelName={view.levelName} date={view.date} />;
}
