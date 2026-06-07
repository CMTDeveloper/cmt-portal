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
  /** Toronto "today" (YYYY-MM-DD) — drives the future-date guard. */
  today: string;
  rows: AttendanceViewRow[];
  // presentCount is intentionally NOT a prop — the live count is derived from
  // `marks` so it updates as the teacher marks students.
  total: number;
}

interface StatusOption {
  value: SetuAttendanceStatus;
  label: string;
  /** Solid fill + border when this status is the active one. */
  color: string;
  /** Faint wash applied to the whole row when flagged into this status. */
  rowWash: string;
  /** Left accent rail color on a flagged row. */
  rail: string;
}

const OPTIONS: StatusOption[] = [
  { value: 'present', label: 'Present', color: 'var(--ok)', rowWash: 'transparent', rail: 'transparent' },
  { value: 'late', label: 'Late', color: 'var(--warn, #a06410)', rowWash: 'var(--setu-warn-soft)', rail: 'var(--warn, #a06410)' },
  { value: 'absent', label: 'Absent', color: 'var(--err)', rowWash: 'var(--setu-err-soft)', rail: 'var(--err)' },
];

const OPTION_BY_VALUE: Record<SetuAttendanceStatus, StatusOption> = {
  present: OPTIONS[0]!,
  late: OPTIONS[1]!,
  absent: OPTIONS[2]!,
};

/** Shift a YYYY-MM-DD by n days (noon-UTC anchor keeps it tz-stable). */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "2026-01-04" → "Sun, Jan 4" for a friendlier nav label (purely presentational). */
function prettyDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const navArrow: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 44,
  height: 44,
  padding: 0,
  fontSize: 20,
  lineHeight: 1,
  borderRadius: 'var(--radiusSm)',
  border: '1px solid var(--line2)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  textDecoration: 'none',
};

interface StatCardProps {
  label: string;
  value: number;
  /** Card fill — a soft status wash or a neutral surface. */
  bg: string;
  /** The big number's color. */
  valueColor: string;
  /** Optional sub-label beneath the metric name (e.g. "at the door"). */
  hint?: string;
}

/** One compact at-a-glance metric: small label on top, big number below. Hoisted
 *  to module scope so it never remounts on the parent's re-renders. */
function StatCard({ label, value, bg, valueColor, hint }: StatCardProps) {
  return (
    <div
      style={{
        background: bg,
        border: '1px solid var(--line)',
        borderRadius: 'var(--radiusSm)',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
        boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 24, fontWeight: 700, color: valueColor, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
        {value}
      </span>
      {hint && (
        <span style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.2 }}>{hint}</span>
      )}
    </div>
  );
}

export function AttendanceMarker({ levelId, levelName, ageLabel, date, today, rows, total }: AttendanceMarkerProps) {
  const [marks, setMarks] = useState<Record<string, SetuAttendanceStatus | null>>(() => {
    const init: Record<string, SetuAttendanceStatus | null> = {};
    for (const r of rows) init[r.mid] = r.status; // null preserved → unmarked
    return init;
  });
  const [pending, startTransition] = useTransition();

  // Live counts — derived from `marks` so they update the instant a teacher marks
  // a student, and from `rows` for the static context. Door-seeded rows already
  // count as Present; unmarked (null) rows count toward neither — only reality.
  const markValues = Object.values(marks);
  const presentCount = markValues.filter((s) => s === 'present').length;
  const lateCount = markValues.filter((s) => s === 'late').length;
  const absentCount = markValues.filter((s) => s === 'absent').length;
  const markedCount = presentCount + lateCount + absentCount;
  const unmarkedCount = total - markedCount;
  const progress = total > 0 ? Math.round((markedCount / total) * 100) : 0; // marking completeness

  const isFuture = date > today; // this class hasn't happened yet
  const canGoNext = addDays(date, 7) <= today; // next Sunday must be past/today

  // Door-aware banner state. The real attendance for a past date often lives in
  // the self-check-in app, surfaced here as door check-ins — so the absence of a
  // PORTAL mark does NOT mean "nobody came". Distinguish the three cases.
  const hasPortalMarks = rows.some((r) => r.source === 'portal'); // teacher already recorded this date
  const doorCount = rows.filter((r) => r.checkedInAtDoor).length; // self-checked-in at the ashram door

  function setStatus(mid: string, status: SetuAttendanceStatus) {
    // Toggle: tapping the already-active status unselects it (back to unmarked).
    setMarks((prev) => ({ ...prev, [mid]: (prev[mid] ?? null) === status ? null : status }));
  }

  // Only marked students (present/late/absent) get an event — unmarked → no
  // event (they stay "unaccounted" for the date). Disable Save when nothing's
  // marked since there's nothing to record.
  const marked: Record<string, SetuAttendanceStatus> = {};
  for (const [mid, s] of Object.entries(marks)) if (s) marked[mid] = s;
  const hasMarks = Object.keys(marked).length > 0;

  function save() {
    startTransition(async () => {
      try {
        const res = await fetch('/api/setu/teacher/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ levelId, date, marks: marked }),
        });
        if (!res.ok) { toast.error('Save failed'); return; }
        toast.success('Attendance saved');
      } catch { toast.error('Network error — please try again.'); }
    });
  }

  return (
    <div style={{ paddingBottom: 'calc(104px + env(safe-area-inset-bottom, 0px))' }}>
      <header style={{ marginBottom: 18 }}>
        <Link href="/teacher" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none', fontWeight: 500 }}>← My classes</Link>
        <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 10, lineHeight: 1.15 }}>{levelName}</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{ageLabel}</p>

        <div
          className="between"
          style={{
            marginTop: 16,
            gap: 12,
            flexWrap: 'wrap',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            padding: 8,
            boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Link
              href={`/teacher/levels/${levelId}/attendance?date=${addDays(date, -7)}`}
              aria-label="Previous Sunday"
              className="btn btn--s"
              style={navArrow}
            >
              ‹
            </Link>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 96, lineHeight: 1.2 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{prettyDate(date)}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', letterSpacing: '0.01em' }}>{date}</span>
            </div>
            {canGoNext ? (
              <Link
                href={`/teacher/levels/${levelId}/attendance?date=${addDays(date, 7)}`}
                aria-label="Next Sunday"
                className="btn btn--s"
                style={navArrow}
              >
                ›
              </Link>
            ) : (
              <span
                aria-label="Next Sunday"
                aria-disabled="true"
                style={{ ...navArrow, opacity: 0.4, pointerEvents: 'none' }}
              >
                ›
              </span>
            )}
          </div>
          <Link
            href={`/teacher/levels/${levelId}/visitors?date=${date}`}
            className="btn btn--g"
            style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', padding: '8px 12px', minHeight: 44 }}
          >
            Visitors →
          </Link>
        </div>
      </header>

      {isFuture ? (
        <div
          className="card"
          style={{ padding: '40px 28px', textAlign: 'center', boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))' }}
        >
          <div
            aria-hidden
            style={{
              width: 52,
              height: 52,
              margin: '0 auto 16px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              background: 'var(--info-soft)',
              color: 'var(--info-deep)',
            }}
          >
            ⏳
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>This class is upcoming</p>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6, maxWidth: 320, marginInline: 'auto', lineHeight: 1.5 }}>
            Attendance for {prettyDate(date)} can be taken on class day.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div
          className="card"
          style={{ padding: '40px 28px', textAlign: 'center', boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))' }}
        >
          <div
            aria-hidden
            style={{
              width: 52,
              height: 52,
              margin: '0 auto 16px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              background: 'var(--accentSoft)',
              color: 'var(--accentDeep)',
            }}
          >
            ✓
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>No students yet</p>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6, maxWidth: 320, marginInline: 'auto', lineHeight: 1.5 }}>
            No enrolled students match this level yet. Once families enroll, their children will appear here for you to mark.
          </p>
          <Link
            href={`/teacher/levels/${levelId}/visitors?date=${date}`}
            className="btn btn--s"
            style={{ marginTop: 18, fontSize: 13 }}
          >
            Mark a visitor instead →
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* At-a-glance stat strip — a row on desktop, wraps to 2-up on narrow
              phones. Enrolled + Checked-in are static per load; Present/Late/Absent
              and Unmarked are live off `marks` and reflect reality (door check-ins
              + teacher marks), not the roster size. Complements (does not replace)
              the live save footer pinned to the bottom. */}
          <div
            role="group"
            aria-label="Attendance summary"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
              gap: 8,
              marginBottom: 2,
            }}
          >
            <StatCard label="Enrolled" value={total} bg="var(--surface2)" valueColor="var(--ink)" />
            <StatCard label="Checked in" hint="at the door" value={doorCount} bg="var(--info-soft)" valueColor="var(--info-deep)" />
            <StatCard label="Present" value={presentCount} bg="var(--setu-ok-soft)" valueColor="var(--ok)" />
            <StatCard label="Late" value={lateCount} bg="var(--setu-warn-soft)" valueColor="var(--warn, #a06410)" />
            <StatCard label="Absent" value={absentCount} bg="var(--setu-err-soft)" valueColor="var(--err)" />
            <StatCard label="Unmarked" value={unmarkedCount} bg="var(--surface2)" valueColor="var(--muted)" />
          </div>

          {/* Door-aware banner. No banner once a teacher has recorded the date in
              the portal (re-saving just updates). If self-check-ins exist, they're
              seeded Present — prompt to mark the rest. Otherwise nobody has checked
              in yet, so prompt to mark students as they arrive. */}
          {!hasPortalMarks &&
            (doorCount > 0 ? (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radiusSm)',
                  background: 'var(--info-soft)',
                  color: 'var(--info-deep)',
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {doorCount} checked in at the door — marked Present. Mark the rest, then Save.
              </div>
            ) : (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radiusSm)',
                  background: 'var(--info-soft)',
                  color: 'var(--info-deep)',
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                No check-ins yet — tap a status as students arrive, then Save.
              </div>
            ))}
          {rows.map((r) => {
            const current = marks[r.mid] ?? null;
            const opt = current ? OPTION_BY_VALUE[current] : null;
            const flagged = current !== null && current !== 'present';
            return (
              <div
                key={r.mid}
                data-testid="att-row"
                className="card"
                style={{
                  padding: '14px 16px',
                  position: 'relative',
                  overflow: 'hidden',
                  borderColor: flagged && opt ? opt.color : 'var(--line)',
                  background: flagged && opt
                    ? `linear-gradient(0deg, ${opt.rowWash}, ${opt.rowWash}), var(--surface)`
                    : 'var(--surface)',
                  transition: 'border-color .15s ease, background .15s ease',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 4,
                    background: flagged && opt ? opt.rail : 'transparent',
                    transition: 'background .15s ease',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, marginBottom: 12 }}>
                  {r.hasSafetyInfo && (
                    <Link
                      href={`/teacher/students/${r.mid}`}
                      aria-label="Safety info"
                      title="Allergy / safety info — tap for details"
                      style={{
                        flexShrink: 0,
                        width: 24,
                        height: 24,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '50%',
                        background: 'var(--setu-err-soft)',
                      }}
                    >
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--err)', display: 'block' }} />
                    </Link>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.firstName} {r.lastName}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                      {r.schoolGrade && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.schoolGrade}</span>}
                      {r.checkedInAtDoor && (
                        <span
                          className="pill"
                          title="Self-checked in at the ashram door"
                          style={{ fontSize: 11, fontWeight: 600, background: 'var(--info-soft)', color: 'var(--info-deep)' }}
                        >
                          · door
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div role="group" aria-label="Attendance status" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {OPTIONS.map((o) => {
                    const active = current === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => setStatus(r.mid, o.value)}
                        aria-pressed={active}
                        style={{
                          padding: '0',
                          minHeight: 48,
                          borderRadius: 'var(--radiusSm)',
                          fontSize: 14,
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontFamily: 'var(--body)',
                          border: active ? `1.5px solid ${o.color}` : '1px solid var(--line2)',
                          background: active ? o.color : 'var(--bg)',
                          color: active ? '#fff' : 'var(--body-text)',
                          boxShadow: active ? 'inset 0 0 0 2px rgba(255,255,255,0.28)' : 'none',
                          transition: 'background .12s ease, color .12s ease, border-color .12s ease, box-shadow .12s ease',
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

      {!isFuture && (
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          background: 'var(--surface)',
          borderTop: '1px solid var(--line)',
          boxShadow: '0 -8px 24px rgba(15,26,34,0.06)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div
          aria-hidden
          style={{ height: 3, background: 'var(--surface2)', overflow: 'hidden' }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: 'var(--ok)',
              transition: 'width .25s ease',
            }}
          />
        </div>
        <div
          className="between"
          style={{ gap: 12, padding: '12px 18px', maxWidth: 760, margin: '0 auto' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.25 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{presentCount} present</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {unmarkedCount > 0 ? `${unmarkedCount} not marked` : 'all marked'}
            </span>
          </div>
          <button
            onClick={save}
            disabled={pending || !hasMarks}
            className="btn btn--p"
            style={{ fontSize: 15, padding: '12px 26px', minHeight: 48, opacity: pending ? 0.65 : 1, whiteSpace: 'nowrap' }}
          >
            {pending ? 'Saving…' : 'Save attendance'}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
