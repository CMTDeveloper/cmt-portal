'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from '@cmt/ui';
import type { SetuAttendanceStatus, RosterStatus } from '@cmt/shared-domain';

export interface MarkerMember {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
  hasSafetyInfo: boolean;
  status: RosterStatus;
}

interface AttendanceMarkerProps {
  levelId: string;
  levelName: string;
  ageLabel: string;
  date: string;
  initialMembers: MarkerMember[];
}

const OPTIONS: { value: SetuAttendanceStatus; label: string; color: string }[] = [
  { value: 'present', label: 'Present', color: 'var(--accent)' },
  { value: 'late', label: 'Late', color: 'var(--warn, #a06410)' },
  { value: 'absent', label: 'Absent', color: 'var(--err)' },
];

export function AttendanceMarker({ levelId, levelName, ageLabel, date, initialMembers }: AttendanceMarkerProps) {
  const [marks, setMarks] = useState<Record<string, SetuAttendanceStatus>>(() => {
    const init: Record<string, SetuAttendanceStatus> = {};
    for (const m of initialMembers) {
      if (m.status !== 'unaccounted') init[m.mid] = m.status;
    }
    return init;
  });
  const [pending, startTransition] = useTransition();

  const total = initialMembers.length;
  const markedCount = Object.keys(marks).length;

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
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j.error === 'not-your-class' ? 'You are not assigned to this class' : 'Save failed');
          return;
        }
        toast.success('Thank you for taking attendance today.');
      } catch {
        toast.error('Network error — please try again.');
      }
    });
  }

  return (
    <div style={{ paddingBottom: 88 }}>
      <header style={{ marginBottom: 16 }}>
        <Link href="/teacher" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>← My classes</Link>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginTop: 8, letterSpacing: '-0.02em' }}>{levelName}</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{ageLabel} · {date}</p>
      </header>

      {total === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
          No enrolled students match this level yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {initialMembers.map((m) => {
            const current = marks[m.mid];
            return (
              <div key={m.mid} className="card" style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {m.hasSafetyInfo && (
                      <Link href={`/teacher/students/${m.mid}`} aria-label="Safety info" title="Allergy / safety info" style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--err)', flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.firstName} {m.lastName}</div>
                      {m.schoolGrade && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.schoolGrade}</div>}
                    </div>
                  </div>
                  {!current && <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>unmarked</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {OPTIONS.map((o) => {
                    const active = current === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => setStatus(m.mid, o.value)}
                        aria-pressed={active}
                        style={{
                          padding: '10px 0', borderRadius: 'var(--radiusSm)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          fontFamily: 'var(--body)',
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

      {/* Sticky save footer */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: 'var(--surface)', borderTop: '1px solid var(--line)', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          <strong style={{ color: 'var(--ink)' }}>{markedCount}</strong> / {total} marked
        </span>
        <button onClick={save} disabled={pending || total === 0} className="btn btn--p" style={{ fontSize: 14, padding: '10px 24px', opacity: pending ? 0.6 : 1 }}>
          {pending ? 'Saving…' : 'Save attendance'}
        </button>
      </div>
    </div>
  );
}
