'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from '@cmt/ui';
import type { SetuAttendanceStatus } from '@cmt/shared-domain';
import type { AttendanceViewRow } from '@/features/setu/teacher/level-attendance-view';

interface AttendanceMarkerProps {
  levelId: string;
  levelName: string;
  ageLabel: string;
  date: string;
  rows: AttendanceViewRow[];
  presentCount: number;
  total: number;
}

const OPTIONS: { value: SetuAttendanceStatus; label: string; color: string }[] = [
  { value: 'present', label: 'Present', color: 'var(--accent)' },
  { value: 'late', label: 'Late', color: 'var(--warn, #a06410)' },
  { value: 'absent', label: 'Absent', color: 'var(--err)' },
];

/** Shift a YYYY-MM-DD by n days (noon-UTC anchor keeps it tz-stable). */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function AttendanceMarker({ levelId, levelName, ageLabel, date, rows, total }: AttendanceMarkerProps) {
  const [marks, setMarks] = useState<Record<string, SetuAttendanceStatus>>(() => {
    const init: Record<string, SetuAttendanceStatus> = {};
    for (const r of rows) init[r.mid] = r.status;
    return init;
  });
  const [pending, startTransition] = useTransition();
  const presentCount = Object.values(marks).filter((s) => s === 'present').length;

  function setStatus(mid: string, status: SetuAttendanceStatus) {
    setMarks((prev) => ({ ...prev, [mid]: status }));
  }

  function save() {
    startTransition(async () => {
      try {
        const res = await fetch('/api/setu/teacher/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ levelId, date, marks }),
        });
        if (!res.ok) { toast.error('Save failed'); return; }
        toast.success('Attendance saved');
      } catch { toast.error('Network error — please try again.'); }
    });
  }

  return (
    <div style={{ paddingBottom: 92 }}>
      <header style={{ marginBottom: 16 }}>
        <Link href="/teacher" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>← My classes</Link>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 8 }}>{levelName}</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{ageLabel}</p>
        <div className="between" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link href={`/teacher/levels/${levelId}/attendance?date=${addDays(date, -7)}`} aria-label="Previous Sunday" className="btn btn--g" style={{ minWidth: 40, padding: '8px 10px' }}>‹</Link>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{date}</span>
            <Link href={`/teacher/levels/${levelId}/attendance?date=${addDays(date, 7)}`} aria-label="Next Sunday" className="btn btn--g" style={{ minWidth: 40, padding: '8px 10px' }}>›</Link>
          </div>
          <Link href={`/teacher/levels/${levelId}/guests?date=${date}`} style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>Visitors →</Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
          No enrolled students match this level yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => {
            const current = marks[r.mid];
            return (
              <div key={r.mid} data-testid="att-row" className="card" style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, marginBottom: 10 }}>
                  {r.hasSafetyInfo && (
                    <Link href={`/teacher/students/${r.mid}`} aria-label="Safety info" title="Allergy / safety info" style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--err)', flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.firstName} {r.lastName}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      {r.schoolGrade && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.schoolGrade}</span>}
                      {r.checkedInAtDoor && <span className="pill" style={{ fontSize: 11, background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>· door</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {OPTIONS.map((o) => {
                    const active = current === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => setStatus(r.mid, o.value)}
                        aria-pressed={active}
                        style={{
                          padding: '10px 0', borderRadius: 'var(--radiusSm)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          fontFamily: 'var(--body)', minHeight: 44,
                          border: active ? `1.5px solid ${o.color}` : '1px solid var(--line2)',
                          background: active ? o.color : 'var(--bg)',
                          color: active ? '#fff' : 'var(--body-text)',
                        }}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: 'var(--surface)', borderTop: '1px solid var(--line)', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--body-text)' }}>{presentCount} / {total} present</span>
        <button onClick={save} disabled={pending || total === 0} className="btn btn--p" style={{ fontSize: 14, padding: '10px 24px', opacity: pending ? 0.6 : 1 }}>
          {pending ? 'Saving…' : 'Save attendance'}
        </button>
      </div>
    </div>
  );
}
