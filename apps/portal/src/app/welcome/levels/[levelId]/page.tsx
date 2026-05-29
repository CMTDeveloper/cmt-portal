import { connection } from 'next/server';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { deriveRoster } from '@/features/setu/teacher/roster';
import { torontoToday } from '@/features/setu/calendar/calendar';
import type { RosterStatus } from '@cmt/shared-domain';

export const metadata = { title: 'Roster — CMT Welcome' };

const STATUS_STYLE: Record<RosterStatus, { label: string; bg: string; fg: string }> = {
  present: { label: 'Present', bg: 'var(--accentSoft)', fg: 'var(--accentDeep)' },
  late: { label: 'Late', bg: 'var(--warn-soft, #f7ecd2)', fg: 'var(--warn, #a06410)' },
  absent: { label: 'Absent', bg: 'var(--err-soft, #f6dcdc)', fg: 'var(--err)' },
  unaccounted: { label: 'Unmarked', bg: 'var(--surface2)', fg: 'var(--muted)' },
};

export default async function WelcomeRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ levelId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  await connection();
  const { levelId } = await params;
  const { date: dateParam } = await searchParams;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : torontoToday();

  const roster = await deriveRoster(levelId, date);
  if (!roster) return <p style={{ color: 'var(--muted)', fontSize: 14 }}>That class doesn’t exist.</p>;

  return (
    <div style={{ maxWidth: 720 }}>
      <Link href="/welcome/levels" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}>
        <SetuIcon.back /> All levels
      </Link>
      <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>{roster.levelName}</h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
        {roster.location} · {roster.ageLabel} · {date} · {roster.markedCount}/{roster.total} marked
      </p>

      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {roster.members.length === 0 ? (
          <div className="card" style={{ padding: 20, color: 'var(--muted)', fontSize: 14 }}>No students match this level.</div>
        ) : (
          roster.members.map((m) => {
            const s = STATUS_STYLE[m.status];
            return (
              <div key={m.mid} className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {m.hasSafetyInfo && <span title="Allergy / safety info" style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--err)' }} />}
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{m.firstName} {m.lastName}</span>
                  {m.schoolGrade && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{m.schoolGrade}</span>}
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, background: s.bg, color: s.fg }}>{s.label}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
