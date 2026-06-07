import { cookies } from 'next/headers';
import Link from 'next/link';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { SetuLogo } from '@cmt/ui';
import { getMyLevels } from '@/features/setu/teacher/levels';

export const metadata = { title: 'My classes — CMT Teacher' };

export default async function TeacherDashboardPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  const raw = sessionCookie ? await verifyPortalSessionCookie(sessionCookie) : null;
  const mid = (raw as { mid?: string } | null)?.mid ?? null;

  const levels = await getMyLevels(mid);

  return (
    <>
      <div style={{ marginBottom: 22 }}>
        <SetuLogo size={18} />
      </div>
      <header style={{ marginBottom: 24 }}>
        <Link href="/family" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none', fontWeight: 500 }}>← My family</Link>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)', marginTop: 10 }}>
          Teacher · Bala Vihar
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 600, marginTop: 6, letterSpacing: '-0.02em' }}>My classes</h1>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6 }}>
          The levels you teach. Tap one to take attendance for today&apos;s class.
        </p>
      </header>

      {levels.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
          You haven&apos;t been assigned to any classes yet. Ask the admin or welcome team to add you.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {levels.map((l) => (
            <Link
              key={l.levelId}
              href={`/teacher/levels/${l.levelId}/attendance`}
              className="card"
              style={{ display: 'block', padding: 18, textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 600 }}>{l.levelName}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                    {l.location} · {l.ageLabel} · {l.curriculum}
                  </div>
                </div>
                <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  Take attendance →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
