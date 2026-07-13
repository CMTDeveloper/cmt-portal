'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from '@cmt/ui';

interface Row {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
}

interface Props {
  levelId: string;
  levelName: string;
  ageLabel: string;
  date: string;
  initial: Row[];
}

/** First glyph of a name for the row avatar; falls back to a neutral dot. */
function initial(name: string): string {
  const c = name.trim()[0];
  return c ? c.toUpperCase() : '·';
}

const sectionHeading: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

export function PreviousStudentsPanel({ levelId, levelName, ageLabel, date, initial: initialRows }: Props) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [pending, startTransition] = useTransition();
  const [busyMid, setBusyMid] = useState<string | null>(null);
  const router = useRouter();

  function markPresent(row: Row) {
    setBusyMid(row.mid);
    startTransition(async () => {
      try {
        const res = await fetch('/api/setu/teacher/attendance/confirm-previous', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ levelId, mid: row.mid, date }),
        });
        if (!res.ok) {
          toast.error('Could not mark present - please try again.');
          return;
        }
        toast.success(`${row.firstName} added to this year's class.`);
        // Siblings confirm together: drop every row sharing this family id.
        setRows((prev) => prev.filter((r) => r.fid !== row.fid));
        // Invalidate the client Router Cache so the "Back to attendance" soft
        // nav re-fetches: the now-confirmed student must show as Present on the
        // Enrolled list, not stale-unmarked. (cacheComponents caches visited
        // routes' RSC payloads; without this the mark isn't visible til reload.)
        router.refresh();
      } catch {
        toast.error('Network error - please try again.');
      } finally {
        setBusyMid(null);
      }
    });
  }

  return (
    <div style={{ paddingBottom: 'calc(40px + env(safe-area-inset-bottom, 0px))' }}>
      <header style={{ marginBottom: 20 }}>
        <Link
          href={`/teacher/levels/${levelId}/attendance?date=${date}`}
          style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none', fontWeight: 500 }}
        >
          {'←'} Back to attendance
        </Link>
        <h1 style={{ fontSize: 26, fontWeight: 600, marginTop: 10, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
          Previous students
        </h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{levelName} · {ageLabel} · {date}</p>
        <p style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 10, lineHeight: 1.5 }}>
          Returning from last year. Mark one present to add their family to this year&apos;s class.
        </p>
      </header>

      {rows.length === 0 ? (
        <div
          className="card"
          style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}
        >
          <div
            aria-hidden
            style={{
              width: 40,
              height: 40,
              margin: '0 auto 12px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              background: 'var(--setu-ok-soft)',
              color: 'var(--ok)',
            }}
          >
            {'✓'}
          </div>
          No returning students - everyone on this roster is enrolled.
        </div>
      ) : (
        <section>
          <h2 style={{ ...sectionHeading, marginBottom: 10 }}>Returning students ({rows.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((row) => {
              const busy = pending && busyMid === row.mid;
              return (
                <div
                  key={row.mid}
                  className="card"
                  style={{
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: 'var(--surface)',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0,
                      width: 38,
                      height: 38,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 15,
                      fontWeight: 600,
                      background: 'var(--info-soft)',
                      color: 'var(--info-deep)',
                    }}
                  >
                    {initial(row.firstName)}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: 'var(--ink)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.firstName} {row.lastName}
                    </div>
                    {row.schoolGrade && (
                      <div style={{ marginTop: 4 }}>
                        <span
                          className="pill"
                          style={{ fontSize: 11, fontWeight: 600, background: 'var(--info-soft)', color: 'var(--info-deep)' }}
                        >
                          {row.schoolGrade}
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => markPresent(row)}
                    className="btn btn--p"
                    style={{
                      flexShrink: 0,
                      fontSize: 14,
                      padding: '11px 18px',
                      minHeight: 44,
                      whiteSpace: 'nowrap',
                      opacity: busy ? 0.65 : 1,
                    }}
                  >
                    {busy ? 'Saving…' : 'Mark present'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
