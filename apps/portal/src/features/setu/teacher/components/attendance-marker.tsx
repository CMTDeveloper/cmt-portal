'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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
  // `present` so it updates as the teacher taps students.
  total: number;
  // Count of previously-enrolled (dropped) students for this level. Drives the
  // "Previous students (N)" entry point; hidden entirely when 0.
  previousCount: number;
}

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
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function initialsOf(first: string, last: string): string {
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

// Decorative avatar palette — a stable [bg, fg] pair picked per name so a class
// list reads as a colourful roster. Not brand tokens (intentional variety).
const AVATAR_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['var(--info-soft)', 'var(--info-deep)'],
  ['var(--accentSoft)', 'var(--accentDeep)'],
  ['var(--setu-ok-soft)', 'var(--ok)'],
  ['var(--setu-warn-soft)', 'var(--warn, #a06410)'],
  ['var(--surface2)', 'var(--body-text)'],
] as const;

function avatarPalette(first: string, last: string): readonly [string, string] {
  const idx = ((first.charCodeAt(0) || 0) + (last.charCodeAt(0) || 0)) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[idx] ?? AVATAR_PALETTE[0]!;
}

const CONTENT_MAX = 540;

// Debounce window for the tap-driven autosave: coalesce a burst of taps into one
// write ~¾s after the teacher pauses. Short enough that little is lost if the app
// is killed; the pagehide beacon is the backstop.
const AUTOSAVE_MS = 700;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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
  flexShrink: 0,
};

interface StatCellProps {
  label: string;
  value: number;
  valueColor: string;
}

/** One compact metric in the 4-up strip: small label on top, big number below.
 *  Hoisted to module scope so it never remounts on the parent's re-renders. */
function StatCell({ label, value, valueColor }: StatCellProps) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: '11px 6px 12px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        borderRight: '1px solid var(--line)',
      }}
    >
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1, color: valueColor }}>
        {value}
      </span>
    </div>
  );
}

export function AttendanceMarker({ levelId, levelName, ageLabel, date, today, rows, total, previousCount }: AttendanceMarkerProps) {
  // Binary model: a student is Present (✓) or not. Seed Present from a prior
  // Present/Late portal mark or a door self-check-in; everything else starts
  // unmarked. Late collapses to Present (they attended) — Late is retired from
  // teacher attendance. On Save, every not-present row is written Absent.
  const [present, setPresent] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const r of rows) init[r.mid] = r.status === 'present' || r.status === 'late';
    return init;
  });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unmarked'>('all');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  // Autosave plumbing: presentRef always mirrors the latest map so the debounced
  // timer / pagehide beacon persist current state (not a stale closure). unsaved
  // tracks whether there's a change the server hasn't confirmed yet.
  const presentRef = useRef(present);
  useEffect(() => { presentRef.current = present; }, [present]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsavedRef = useRef(false);
  // Clear a pending debounce on unmount so a late timer never fires saveNow on a
  // dead component (e.g. after date navigation).
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const presentCount = rows.reduce((n, r) => n + (present[r.mid] ? 1 : 0), 0);
  const unmarkedCount = total - presentCount;
  const doorCount = rows.filter((r) => r.checkedInAtDoor).length;
  // The per-student grade is redundant when the whole class is one grade — the
  // header already shows it (e.g. "Gr 1"). Only surface it on multi-grade levels
  // (e.g. Level 2 = Gr 2 & 3), where it distinguishes students.
  const showGrade = useMemo(
    () => new Set(rows.map((r) => r.schoolGrade).filter(Boolean)).size > 1,
    [rows],
  );
  const allPresent = total > 0 && presentCount === total;
  const progress = total > 0 ? Math.round((presentCount / total) * 100) : 0;

  const isFuture = date > today; // this class hasn't happened yet
  const canGoNext = addDays(date, 7) <= today; // next Sunday must be past/today
  const hasPortalMarks = rows.some((r) => r.source === 'portal'); // teacher already recorded this date

  const q = query.trim().toLowerCase();
  const visibleRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (filter === 'all' || !present[r.mid]) &&
          (q === '' || `${r.firstName} ${r.lastName}`.toLowerCase().includes(q)),
      ),
    [rows, filter, present, q],
  );

  // Build the FULL binary map from the latest present ref — tapped → present,
  // everyone else → absent. Search/filter is display-only; the record written is
  // always the whole roster (so "not tapped = absent" holds).
  function buildMarks(): Record<string, SetuAttendanceStatus> {
    const marks: Record<string, SetuAttendanceStatus> = {};
    for (const r of rows) marks[r.mid] = presentRef.current[r.mid] ? 'present' : 'absent';
    return marks;
  }

  async function saveNow() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/setu/teacher/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levelId, date, marks: buildMarks() }),
      });
      if (!res.ok) { setSaveStatus('error'); return; }
      unsavedRef.current = false;
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }

  // No manual Save button: every tap schedules a debounced autosave. Untapped
  // students persist as Absent on each save, so the record is always complete.
  function scheduleSave() {
    unsavedRef.current = true;
    setSaveStatus('saving');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void saveNow(); }, AUTOSAVE_MS);
  }

  function toggle(mid: string) {
    setPresent((prev) => ({ ...prev, [mid]: !prev[mid] }));
    scheduleSave();
  }

  function markAllToggle() {
    setPresent(() => {
      const next: Record<string, boolean> = {};
      for (const r of rows) next[r.mid] = !allPresent; // all → clear, else → all present
      return next;
    });
    scheduleSave();
  }

  function jumpNext() {
    if (typeof document === 'undefined') return;
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-unmarked="1"]'));
    if (candidates.length === 0) return;
    const viewTop = 120; // below the sticky top bar
    const target = candidates.find((el) => el.getBoundingClientRect().top > viewTop) ?? candidates[0]!;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Best-effort flush when the teacher backgrounds/closes the page mid-edit:
  // a pending debounce would otherwise be lost. sendBeacon survives unload and
  // carries the __session cookie (same-origin), so the write authenticates.
  useEffect(() => {
    const flush = () => {
      if (!unsavedRef.current) return;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      const marks: Record<string, SetuAttendanceStatus> = {};
      for (const r of rows) marks[r.mid] = presentRef.current[r.mid] ? 'present' : 'absent';
      const body = JSON.stringify({ levelId, date, marks });
      navigator.sendBeacon?.('/api/setu/teacher/attendance', new Blob([body], { type: 'application/json' }));
      unsavedRef.current = false;
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [levelId, date, rows]);

  const filterBtn = (active: boolean): React.CSSProperties => ({
    border: 'none',
    background: active ? 'var(--surface)' : 'transparent',
    color: active ? 'var(--ink)' : 'var(--body-text)',
    boxShadow: active ? '0 1px 2px rgba(15,26,34,0.10)' : 'none',
    fontSize: 13,
    fontWeight: 600,
    padding: '7px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--body)',
  });

  return (
    <div style={{ maxWidth: CONTENT_MAX, margin: '0 auto', paddingBottom: 'calc(104px + env(safe-area-inset-bottom, 0px))' }}>
      <header>
        <Link href="/teacher" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none', fontWeight: 500 }}>← My classes</Link>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: '11px 0 0', lineHeight: 1.15 }}>{levelName}</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '3px 0 0' }}>{ageLabel}</p>

        {/* Date nav — prev/next reload the page with ?date= so the roster + door
            check-ins are re-read server-side for the chosen Sunday. */}
        <div
          className="between"
          style={{
            marginTop: 16,
            gap: 10,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            padding: 8,
            boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <Link href={`/teacher/levels/${levelId}/attendance?date=${addDays(date, -7)}`} aria-label="Previous Sunday" style={navArrow}>
              ‹
            </Link>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 92, lineHeight: 1.2 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{prettyDate(date)}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{date}</span>
            </div>
            {canGoNext ? (
              <Link href={`/teacher/levels/${levelId}/attendance?date=${addDays(date, 7)}`} aria-label="Next Sunday" style={navArrow}>
                ›
              </Link>
            ) : (
              <span aria-label="Next Sunday" aria-disabled="true" style={{ ...navArrow, opacity: 0.35, pointerEvents: 'none' }}>
                ›
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {previousCount > 0 && (
              <Link
                href={`/teacher/levels/${levelId}/previous?date=${date}`}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--accentDeep)',
                  background: 'var(--accentSoft)',
                  borderRadius: 10,
                  padding: '9px 12px',
                  minHeight: 44,
                  display: 'inline-flex',
                  alignItems: 'center',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                Previous students ({previousCount})
              </Link>
            )}
            <Link
              href={`/teacher/levels/${levelId}/visitors?date=${date}`}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--accentDeep)',
                background: 'var(--accentSoft)',
                borderRadius: 10,
                padding: '9px 12px',
                minHeight: 44,
                display: 'inline-flex',
                alignItems: 'center',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Visitors →
            </Link>
          </div>
        </div>
      </header>

      {isFuture ? (
        <div className="card" style={{ marginTop: 16, padding: '40px 28px', textAlign: 'center', boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))' }}>
          <div
            aria-hidden
            style={{ width: 52, height: 52, margin: '0 auto 16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, background: 'var(--info-soft)', color: 'var(--info-deep)' }}
          >
            ⏳
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>This class is upcoming</p>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6, maxWidth: 320, marginInline: 'auto', lineHeight: 1.5 }}>
            Attendance for {prettyDate(date)} can be taken on class day.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card" style={{ marginTop: 16, padding: '40px 28px', textAlign: 'center', boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))' }}>
          <div
            aria-hidden
            style={{ width: 52, height: 52, margin: '0 auto 16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}
          >
            ✓
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>No students yet</p>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6, maxWidth: 320, marginInline: 'auto', lineHeight: 1.5 }}>
            No enrolled students match this level yet. Once families enroll, their children will appear here for you to mark.
          </p>
          <Link href={`/teacher/levels/${levelId}/visitors?date=${date}`} className="btn btn--s" style={{ marginTop: 18, fontSize: 13 }}>
            Mark a visitor instead →
          </Link>
        </div>
      ) : (
        <>
          {/* 3-up summary: Enrolled is static per load; Present + Unmarked are
              live off the taps. Door self-check-ins already seed Present (there
              is no separate "arrived" state — anyone checked in at the front is
              Present), so the door count only surfaces in the banner below. */}
          <div
            role="group"
            aria-label="Attendance summary"
            style={{
              marginTop: 14,
              display: 'flex',
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
              boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
            }}
          >
            <StatCell label="Enrolled" value={total} valueColor="var(--ink)" />
            <StatCell label="Present" value={presentCount} valueColor="var(--ok)" />
            <span style={{ flex: 1, minWidth: 0, display: 'flex' }}>
              <StatCell label="Unmarked" value={unmarkedCount} valueColor="var(--accentDeep)" />
            </span>
          </div>

          {/* Door-aware banner — only before this date has a portal mark. */}
          {!hasPortalMarks && (
            <div
              style={{
                marginTop: 12,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 9,
                background: 'var(--info-soft)',
                color: 'var(--info-deep)',
                borderRadius: 'var(--radiusSm)',
                padding: '10px 12px',
                fontSize: 12.5,
                lineHeight: 1.45,
              }}
            >
              <span aria-hidden style={{ flexShrink: 0, width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', marginTop: 5 }} />
              <span>
                {doorCount > 0
                  ? `${doorCount} checked in on arrival via the family app — already marked present. Tap the rest as they arrive — it saves automatically.`
                  : 'Tap each student present as they arrive — it saves automatically. Anyone left unmarked is recorded absent.'}
              </span>
            </div>
          )}

          {/* Search */}
          <div style={{ marginTop: 14, position: 'relative' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}>
              <circle cx="11" cy="11" r="7" stroke="var(--muted)" strokeWidth="2" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search students"
              aria-label="Search students"
              style={{
                width: '100%',
                padding: '11px 38px',
                border: '1px solid var(--line2)',
                borderRadius: 10,
                background: 'var(--surface)',
                fontSize: 14,
                color: 'var(--ink)',
                fontFamily: 'var(--body)',
                boxSizing: 'border-box',
              }}
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'var(--surface2)', color: 'var(--body-text)', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ×
              </button>
            )}
          </div>

          {/* Filter pills + mark-all shortcut */}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', background: 'var(--surface2)', borderRadius: 10, padding: 3, gap: 3 }}>
              <button type="button" onClick={() => setFilter('all')} style={filterBtn(filter === 'all')} aria-pressed={filter === 'all'}>
                All
              </button>
              <button type="button" onClick={() => setFilter('unmarked')} style={filterBtn(filter === 'unmarked')} aria-pressed={filter === 'unmarked'}>
                Unmarked {unmarkedCount}
              </button>
            </div>
            <button
              type="button"
              onClick={markAllToggle}
              style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', padding: '4px 2px', fontFamily: 'var(--body)' }}
            >
              {allPresent ? 'Clear all' : 'Mark all present'}
            </button>
          </div>

          <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', margin: '16px 0 8px' }}>
            Enrolled students ({total})
          </h2>

          {/* Roster — each row is a single tap target that toggles Present. */}
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
            {visibleRows.map((r) => {
              const isP = !!present[r.mid];
              const [avBg, avFg] = avatarPalette(r.firstName, r.lastName);
              return (
                <button
                  key={r.mid}
                  type="button"
                  data-testid="att-row"
                  data-unmarked={isP ? '0' : '1'}
                  onClick={() => toggle(r.mid)}
                  aria-pressed={isP}
                  aria-label={`${r.firstName} ${r.lastName}${r.hasSafetyInfo ? ' — has allergy / safety info on file' : ''}${isP ? ' — present' : ' — not marked'}`}
                  style={{
                    position: 'relative',
                    width: '100%',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '13px 14px 13px 16px',
                    background: isP ? 'linear-gradient(0deg, var(--setu-ok-soft), var(--setu-ok-soft)), var(--surface)' : 'var(--surface)',
                    border: `1px solid ${isP ? 'var(--ok)' : 'var(--line)'}`,
                    borderRadius: 12,
                    cursor: 'pointer',
                    boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
                    overflow: 'hidden',
                    fontFamily: 'var(--body)',
                    transition: 'background .15s ease, border-color .15s ease',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: isP ? 'var(--ok)' : 'transparent' }} />
                  <span
                    aria-hidden
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      fontWeight: 700,
                      position: 'relative',
                      background: isP ? 'var(--setu-ok-soft)' : avBg,
                      color: isP ? 'var(--ok)' : avFg,
                      transition: 'background .15s ease, color .15s ease',
                    }}
                  >
                    {initialsOf(r.firstName, r.lastName)}
                    {r.hasSafetyInfo && (
                      <span
                        title="Allergy / safety info on file"
                        style={{ position: 'absolute', top: -2, right: -2, width: 13, height: 13, borderRadius: '50%', background: 'var(--err)', border: '2px solid var(--surface)' }}
                      />
                    )}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.firstName} {r.lastName}
                    </span>
                    {showGrade && r.schoolGrade && (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Gr {r.schoolGrade}</span>
                    )}
                  </span>
                  {isP ? (
                    <span aria-hidden style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--ok)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
                      ✓
                    </span>
                  ) : (
                    <span aria-hidden style={{ width: 26, height: 26, borderRadius: '50%', border: '1.7px solid var(--line2)', background: 'var(--surface)', flexShrink: 0 }} />
                  )}
                </button>
              );
            })}
          </div>

          {visibleRows.length === 0 && (
            <div style={{ textAlign: 'center', padding: '34px 16px', color: 'var(--muted)', fontSize: 14 }}>No students match.</div>
          )}
        </>
      )}

      {/* Floating "next unmarked" jump — only when there's something left to mark. */}
      {!isFuture && rows.length > 0 && unmarkedCount > 0 && (
        <button
          type="button"
          onClick={jumpNext}
          style={{
            position: 'fixed',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: 'calc(94px + env(safe-area-inset-bottom, 0px))',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            background: 'var(--ink)',
            color: 'var(--surface)',
            border: 'none',
            borderRadius: 999,
            padding: '10px 17px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(15,26,34,0.28)',
            fontFamily: 'var(--body)',
            zIndex: 5,
          }}
        >
          <span>Next unmarked</span>
          <span style={{ fontSize: 14, lineHeight: 1 }}>↓</span>
        </button>
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
            zIndex: 4,
          }}
        >
          <div aria-hidden style={{ height: 3, background: 'var(--surface2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--ok)', transition: 'width .25s ease' }} />
          </div>
          <div className="between" style={{ gap: 12, padding: '11px 18px', maxWidth: CONTENT_MAX, margin: '0 auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.25 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{presentCount} present</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {saveStatus === 'idle'
                  ? 'Tap present as they arrive'
                  : unmarkedCount > 0
                    ? `${unmarkedCount} absent`
                    : 'All present'}
              </span>
            </div>
            {/* No manual Save — attendance auto-saves as the teacher taps. The
                status shows Saving/Saved; on failure a Retry button appears so a
                write is never silently lost. */}
            {saveStatus === 'error' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--err)', whiteSpace: 'nowrap' }}>Not saved</span>
                <button
                  type="button"
                  onClick={() => void saveNow()}
                  className="btn btn--p"
                  style={{ fontSize: 14, padding: '10px 18px', minHeight: 44, whiteSpace: 'nowrap' }}
                >
                  Retry
                </button>
              </div>
            ) : (
              <span
                role="status"
                aria-live="polite"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: 14,
                  fontWeight: 600,
                  minHeight: 44,
                  paddingInline: 4,
                  whiteSpace: 'nowrap',
                  color: saveStatus === 'saved' ? 'var(--ok)' : 'var(--muted)',
                }}
              >
                {saveStatus === 'saving' ? (
                  <>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--muted)' }} />
                    Saving…
                  </>
                ) : saveStatus === 'saved' ? (
                  <>✓ Saved</>
                ) : (
                  <span style={{ fontWeight: 500 }}>Auto-saves</span>
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
