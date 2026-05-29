import { connection } from 'next/server';
import Link from 'next/link';
import { getLevels } from '@/features/setu/teacher/levels';
import { findUnassignedStudents, type UnassignedStudent } from '@/features/setu/teacher/welcome-read';
import type { Location } from '@cmt/shared-domain';

export const metadata = { title: 'Levels & rosters — CMT Welcome' };

export default async function WelcomeLevelsPage() {
  await connection();

  const levels = (await getLevels()).filter((l) => l.enabled);
  const locations = [...new Set(levels.map((l) => l.location))] as Location[];

  const unassignedByLocation = new Map<Location, UnassignedStudent[]>();
  await Promise.all(
    locations.map(async (loc) => {
      unassignedByLocation.set(loc, await findUnassignedStudents(loc));
    }),
  );

  return (
    <div style={{ maxWidth: 760 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em' }}>Levels &amp; rosters</h1>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
          Read-only view of every Bala Vihar class and its roster. Tap a level to see attendance.
        </p>
      </header>

      {levels.length === 0 && <div className="card" style={{ padding: 24, color: 'var(--muted)', fontSize: 14 }}>No levels configured yet.</div>}

      {locations.map((loc) => {
        const locLevels = levels.filter((l) => l.location === loc);
        const unassigned = unassignedByLocation.get(loc) ?? [];
        return (
          <section key={loc} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{loc}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {locLevels.map((l) => (
                <Link key={l.levelId} href={`/welcome/levels/${l.levelId}`} className="card" style={{ display: 'block', padding: 16, textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>{l.levelName}</div>
                      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{l.ageLabel} · {l.curriculum} · {l.teacherRefs.length} teacher{l.teacherRefs.length !== 1 ? 's' : ''}</div>
                    </div>
                    <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>View →</span>
                  </div>
                </Link>
              ))}
            </div>

            {unassigned.length > 0 && (
              <div className="card" style={{ padding: 16, marginTop: 12, borderLeft: '3px solid var(--warn, #a06410)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warn, #a06410)', marginBottom: 8 }}>
                  {unassigned.length} unassigned student{unassigned.length !== 1 ? 's' : ''} — grade matches no level here
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {unassigned.map((u) => (
                    <Link key={u.mid} href={`/welcome/family/${u.fid}`} style={{ fontSize: 13, color: 'var(--body-text)', textDecoration: 'none' }}>
                      {u.firstName} {u.lastName} <span style={{ color: 'var(--muted)' }}>· {u.schoolGrade ?? 'no grade set'}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
