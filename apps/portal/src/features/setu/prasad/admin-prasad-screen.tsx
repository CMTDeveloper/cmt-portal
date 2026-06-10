'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast, SetuIcon } from '@cmt/ui';
import { CURRENT_PRASAD_PIDS } from './constants';
import type { PrasadPreviewResult } from './publish-assignments';
import {
  fetchPrasadPreview,
  publishPrasad,
  fetchPrasadAssignments,
  adminReassignPrasad,
  type AdminPrasadAssignment,
} from './prasad-client';

// Prasad rotation — admin preview → publish + manage. Each Bala Vihar family
// gets one prasad Sunday per school year; the engine clusters families onto the
// Sunday nearest a child's birthday month and spills the rest to fill the cap.
// This screen mirrors the school-year rollover preview UX (semantic stat rails,
// disclosure groups, reason chips, module-scope sub-components) so the two
// once-a-year BV admin flows feel like one family.

type PeriodOption = (typeof CURRENT_PRASAD_PIDS)[number];

// ---------------------------------------------------------------------------
// Pure helpers (module scope — no remount churn, easy to reason about)
// ---------------------------------------------------------------------------

/** "2026-03-22" → "Sun, Mar 22". Noon-UTC + UTC render avoids the off-by-one a
 *  bare `new Date('2026-03-22')` introduces (parsed as midnight UTC, which can
 *  fall on the prior day in Toronto) — same pattern as the calendar/attendance
 *  views. */
function prettySunday(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

type ReasonKey = 'birthday-month' | 'spill' | 'no-birth-month';

const REASON_META: Record<ReasonKey, { label: string; bg: string; fg: string }> = {
  // Birthday month is the happy path — accent (orange) so it reads as the
  // intended placement. Spill is a soft warn (moved to fill a Sunday). No
  // birth month is the quietest, neutral surface treatment.
  'birthday-month': { label: 'Birthday month', bg: 'var(--accentSoft)', fg: 'var(--accentDeep)' },
  spill: { label: 'Moved nearby', bg: 'var(--setu-warn-soft)', fg: 'var(--warn, #a06410)' },
  'no-birth-month': { label: 'No birth month', bg: 'var(--surface2)', fg: 'var(--muted)' },
};

const SOURCE_BADGE: Record<string, string> = {
  'family-move': 'moved by family',
  admin: 'moved by admin',
};

// ---------------------------------------------------------------------------
// Sub-components (module scope so <select>/<input> never remount on re-render)
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'prasad-spin 0.7s linear infinite',
        verticalAlign: '-2px',
      }}
    />
  );
}

function LocationTabs({
  options,
  activePid,
  onSelect,
}: {
  options: readonly PeriodOption[];
  activePid: string;
  onSelect: (p: PeriodOption) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Location"
      style={{
        display: 'inline-flex',
        gap: 4,
        padding: 4,
        borderRadius: 999,
        background: 'var(--surface2)',
        border: '1px solid var(--line)',
      }}
    >
      {options.map((opt) => {
        const on = opt.pid === activePid;
        return (
          <button
            key={opt.pid}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(opt)}
            className="prasad-tab"
            style={{
              minHeight: 44,
              padding: '0 18px',
              borderRadius: 999,
              border: 0,
              cursor: on ? 'default' : 'pointer',
              fontFamily: 'var(--body)',
              fontSize: 14,
              fontWeight: 600,
              color: on ? '#fff' : 'var(--body-text)',
              background: on ? 'var(--accent)' : 'transparent',
              boxShadow: on ? '0 1px 4px rgba(217,102,66,0.28)' : 'none',
              transition: 'background .15s ease, color .15s ease',
            }}
          >
            {opt.location}
          </button>
        );
      })}
    </div>
  );
}

/** Big scannable metric with a semantic top rail — same atom the rollover
 *  preview uses, so the two BV admin flows share a visual vocabulary. */
function StatBlock({
  value,
  label,
  valueColor,
  bg,
  rail,
  border,
}: {
  value: number;
  label: string;
  valueColor: string;
  bg: string;
  rail: string;
  border: string;
}) {
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 'var(--radiusSm)',
        textAlign: 'center',
        minWidth: 0,
        overflow: 'hidden',
        boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
      }}
    >
      <span aria-hidden style={{ display: 'block', height: 3, background: rail }} />
      <span style={{ padding: '13px 8px', display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
        <span
          style={{
            fontSize: 'clamp(24px, 7vw, 30px)',
            fontWeight: 700,
            color: valueColor,
            lineHeight: 1,
            letterSpacing: '-0.03em',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--body-text)', lineHeight: 1.25 }}>{label}</span>
      </span>
    </div>
  );
}

function ReasonChip({ reason }: { reason: string }) {
  const meta = REASON_META[reason as ReasonKey] ?? REASON_META['no-birth-month'];
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 9px',
        borderRadius: 999,
        background: meta.bg,
        color: meta.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  );
}

/** One proposed Sunday: a date heading + family-count, then the family rows. */
function ProposedSundayGroup({
  date,
  rows,
}: {
  date: string;
  rows: PrasadPreviewResult['rows'];
}) {
  return (
    <div
      data-testid="prasad-sunday-group"
      style={{ border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', overflow: 'hidden', background: 'var(--surface)' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 10,
          padding: '11px 14px',
          background: 'var(--surface2)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>{prettySunday(date)}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {rows.length} famil{rows.length === 1 ? 'y' : 'ies'}
        </span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((r, i) => (
          <li
            key={r.fid}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderTop: i === 0 ? 'none' : '1px solid var(--line)',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.familyName}
              </span>
              {r.youngestName && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>youngest · {r.youngestName}</span>
              )}
            </span>
            <ReasonChip reason={r.reason} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Families-per-Sunday cap. Commits on Enter or blur (not every keystroke) so a
 *  preview re-fetch fires once the admin has settled on a number. ≥44px. */
function CapInput({
  defaultCap,
  disabled,
  onCommit,
}: {
  defaultCap: number;
  disabled: boolean;
  onCommit: (cap: number) => void;
}) {
  const [value, setValue] = useState(String(defaultCap));

  // Reset the field whenever a new preview arrives with a different cap
  // (e.g. switching locations or after a committed cap change).
  useEffect(() => {
    setValue(String(defaultCap));
  }, [defaultCap]);

  function commit() {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) {
      setValue(String(defaultCap));
      return;
    }
    if (n !== defaultCap) onCommit(n);
    setValue(String(n));
  }

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Families per Sunday</span>
      <input
        data-testid="prasad-cap-input"
        type="number"
        min={1}
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="prasad-cap"
        style={{
          width: 88,
          minHeight: 44,
          padding: '0 12px',
          fontSize: 15,
          fontWeight: 600,
          fontFamily: 'var(--body)',
          color: 'var(--ink)',
          background: 'var(--surface)',
          border: '1px solid var(--line2)',
          borderRadius: 'var(--radiusSm)',
          fontVariantNumeric: 'tabular-nums',
          opacity: disabled ? 0.6 : 1,
        }}
      />
    </label>
  );
}

/** Collapsible disclosure (published-assignments manager groups). */
function Disclosure({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', overflow: 'hidden', background: 'var(--surface)' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="prasad-disclosure"
        style={{
          width: '100%',
          minHeight: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          fontFamily: 'var(--body)',
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--ink)',
          textAlign: 'left',
        }}
      >
        <span style={{ flex: 1 }}>
          {title} · {count} famil{count === 1 ? 'y' : 'ies'}
        </span>
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            color: 'var(--muted)',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform .18s ease',
            display: 'inline-flex',
            fontSize: 11,
          }}
        >
          ▶
        </span>
      </button>
      {open && <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>}
    </div>
  );
}

/** One published assignment row: family name, source badge (when moved), and
 *  Reassign (inline date select + Save) / Cancel actions. Cancelling is a
 *  confirm()-gated destructive action; reassign moves to another Sunday in the
 *  preview's perSunday set. Both ≥44px, wrap onto their own line on narrow rows. */
function AssignmentRow({
  assignment,
  sundays,
  onMutated,
}: {
  assignment: AdminPrasadAssignment;
  sundays: string[];
  onMutated: () => void;
}) {
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const busy = saving || cancelling;

  // Reassign options = the OTHER Sundays present in the preview (never the
  // family's current date).
  const options = sundays.filter((d) => d !== assignment.date);

  async function save() {
    if (!target || busy) return;
    setSaving(true);
    try {
      await adminReassignPrasad({ paid: assignment.paid, date: target });
      toast.success(`${assignment.familyName} moved to ${prettySunday(target)}`);
      onMutated();
    } catch {
      toast.error('Could not reassign. Please try again.');
      setSaving(false);
    }
  }

  async function cancel() {
    if (busy) return;
    if (!window.confirm(`Cancel ${assignment.familyName}'s prasad assignment? They will be removed from the schedule.`)) return;
    setCancelling(true);
    try {
      await adminReassignPrasad({ paid: assignment.paid, cancel: true });
      toast.success(`${assignment.familyName} removed from the schedule`);
      onMutated();
    } catch {
      toast.error('Could not cancel. Please try again.');
      setCancelling(false);
    }
  }

  const badge = SOURCE_BADGE[assignment.source];

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        padding: '10px 12px',
        borderRadius: 'var(--radiusSm)',
        background: 'var(--surface2)',
        listStyle: 'none',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {assignment.familyName}
        </span>
        {badge && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span aria-hidden style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--muted)' }} />
            {badge}
          </span>
        )}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
        <select
          aria-label={`Reassign ${assignment.familyName} to another Sunday`}
          value={target}
          disabled={busy || options.length === 0}
          onChange={(e) => setTarget(e.target.value)}
          className="prasad-reassign-select"
          style={{
            minHeight: 44,
            padding: '0 28px 0 11px',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'var(--body)',
            color: target ? 'var(--ink)' : 'var(--muted)',
            background: 'var(--surface)',
            border: '1px solid var(--line2)',
            borderRadius: 999,
            cursor: busy || options.length === 0 ? 'default' : 'pointer',
            opacity: busy || options.length === 0 ? 0.6 : 1,
            appearance: 'none',
            WebkitAppearance: 'none',
            MozAppearance: 'none',
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23a06410' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 11px center',
          }}
        >
          <option value="" disabled>
            Move to…
          </option>
          {options.map((d) => (
            <option key={d} value={d}>
              {prettySunday(d)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={busy || !target}
          aria-label={`Save reassignment for ${assignment.familyName}`}
          className="prasad-save"
          style={{
            minHeight: 44,
            minWidth: 44,
            padding: '0 14px',
            fontSize: 12.5,
            fontWeight: 700,
            fontFamily: 'var(--body)',
            color: '#fff',
            background: 'var(--accent)',
            border: '1px solid var(--accentDeep)',
            borderRadius: 999,
            cursor: busy || !target ? 'default' : 'pointer',
            opacity: busy || !target ? 0.55 : 1,
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          {saving ? (
            <>
              <Spinner /> Saving…
            </>
          ) : (
            'Save'
          )}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          aria-label={`Cancel ${assignment.familyName}'s assignment`}
          className="prasad-cancel"
          style={{
            minHeight: 44,
            padding: '0 13px',
            fontSize: 12.5,
            fontWeight: 600,
            fontFamily: 'var(--body)',
            color: 'var(--err, #a23a2e)',
            background: 'var(--surface)',
            border: '1px solid var(--line2)',
            borderRadius: 999,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.55 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </button>
      </span>
    </li>
  );
}

/** Quiet, retry-able fetch error line — never crashes the screen. */
function RetryLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {message}
      <button
        type="button"
        onClick={onRetry}
        className="prasad-textbtn"
        style={{
          minHeight: 44,
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          color: 'var(--accentDeep)',
          fontFamily: 'var(--body)',
          fontSize: 13,
          fontWeight: 600,
          padding: '0 4px',
        }}
      >
        Try again
      </button>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Published-assignments manager (own fetch lifecycle, keyed to the active pid)
// ---------------------------------------------------------------------------

function AssignmentsManager({ pid, sundays }: { pid: string; sundays: string[] }) {
  const [assignments, setAssignments] = useState<AdminPrasadAssignment[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    fetchPrasadAssignments(pid)
      .then((rows) => setAssignments(rows.filter((a) => a.status !== 'cancelled')))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [pid]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && assignments === null) {
    return <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading published assignments…</p>;
  }
  if (error && assignments === null) {
    return <RetryLine message="Couldn't load the published assignments." onRetry={load} />;
  }

  const active = assignments ?? [];
  if (active.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--muted)' }}>No families have been assigned yet — publish a schedule above.</p>;
  }

  // Group by date, ordered chronologically.
  const byDate = new Map<string, AdminPrasadAssignment[]>();
  for (const a of active) {
    const list = byDate.get(a.date) ?? [];
    list.push(a);
    byDate.set(a.date, list);
  }
  const dates = [...byDate.keys()].sort((x, y) => x.localeCompare(y));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {dates.map((d, i) => {
        const list = byDate.get(d)!;
        return (
          <Disclosure key={d} title={prettySunday(d)} count={list.length} defaultOpen={i === 0}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map((a) => (
                <AssignmentRow key={a.paid} assignment={a} sundays={sundays} onMutated={load} />
              ))}
            </ul>
          </Disclosure>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function AdminPrasadScreen() {
  const [period, setPeriod] = useState<PeriodOption>(CURRENT_PRASAD_PIDS[0]);
  const [preview, setPreview] = useState<PrasadPreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // Cap currently driving the preview: undefined → use engine default. Reset on
  // location change so each location starts from its own computed default.
  const [cap, setCap] = useState<number | undefined>(undefined);

  const { pid, location } = period;

  const runPreview = useCallback(
    (nextCap?: number) => {
      setLoading(true);
      setError(false);
      fetchPrasadPreview(pid, nextCap)
        .then(setPreview)
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    },
    [pid],
  );

  // Mount + tab change → preview with the current cap (cap resets to undefined
  // on a location switch via selectPeriod).
  useEffect(() => {
    runPreview(cap);
  }, [runPreview, cap]);

  function selectPeriod(next: PeriodOption) {
    if (next.pid === pid) return;
    setPreview(null);
    setCap(undefined);
    setPeriod(next);
  }

  function commitCap(nextCap: number) {
    setCap(nextCap);
  }

  async function onPublish() {
    if (!preview || publishing) return;
    setPublishing(true);
    try {
      const result = await publishPrasad(pid, preview.cap);
      setPreview(result);
      toast.success(`${location} prasad schedule published`);
      // re-fetch the preview so the post-publish state (mostly keptExisting)
      // reflects what was written.
      runPreview(cap);
    } catch {
      toast.error('Could not publish the schedule. Please try again.');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <style>{`
        @keyframes prasad-spin { to { transform: rotate(360deg); } }
        .prasad-tab:not([aria-selected="true"]):hover { background: var(--surface) !important; }
        .prasad-cta:not(:disabled) { transition: background .15s ease, transform .12s ease, box-shadow .15s ease; }
        .prasad-cta:not(:disabled):hover { box-shadow: 0 4px 14px rgba(217,102,66,0.25); }
        .prasad-cta:not(:disabled):active { transform: translateY(1px); }
        .prasad-disclosure { transition: background .15s ease; }
        .prasad-disclosure:hover { background: var(--surface2) !important; }
        .prasad-cap:focus-visible { outline: none; border-color: var(--accent) !important; box-shadow: 0 0 0 3px var(--accentSoft); }
        .prasad-reassign-select:focus-visible { outline: none; border-color: var(--accent) !important; box-shadow: 0 0 0 3px var(--accentSoft); }
        .prasad-save:not(:disabled):hover { background: var(--accentDeep) !important; box-shadow: 0 3px 10px rgba(217,102,66,0.28); }
        .prasad-save:not(:disabled):active { transform: translateY(1px); }
        .prasad-cancel:not(:disabled):hover { border-color: var(--err, #a23a2e) !important; background: var(--setu-warn-soft) !important; }
        .prasad-textbtn:hover { text-decoration: underline; }
        @media (prefers-reduced-motion: reduce) {
          [style*="prasad-spin"] { animation-duration: 0.01ms !important; }
        }
      `}</style>

      <header style={{ marginBottom: 24 }}>
        <Link
          href="/admin"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 14, fontWeight: 500 }}
        >
          <SetuIcon.back /> Back to admin
        </Link>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Admin · Bala Vihar</p>
        <h1 style={{ fontSize: 'clamp(26px, 7vw, 36px)', fontWeight: 400, marginTop: 6, lineHeight: 1.12, letterSpacing: '-0.01em' }}>
          Prasad rotation
        </h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 600, lineHeight: 1.55 }}>
          Assign each Bala Vihar family one prasad Sunday for the year — clustered near a child&rsquo;s birthday month,
          then spilled to fill each Sunday up to the cap. Preview, then publish.
        </p>
        <div style={{ marginTop: 18 }}>
          <LocationTabs options={CURRENT_PRASAD_PIDS} activePid={pid} onSelect={selectPeriod} />
        </div>
      </header>

      {loading && preview === null && (
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>Loading the {location} preview…</p>
      )}

      {error && preview === null && (
        <RetryLine message={`Couldn't load the ${location} preview.`} onRetry={() => runPreview(cap)} />
      )}

      {preview !== null && preview.eligibleSundayCount === 0 && <EmptyCalendar location={location} />}

      {preview !== null && preview.eligibleSundayCount > 0 && (
        <PreviewBody
          preview={preview}
          publishing={publishing}
          loading={loading}
          onCommitCap={commitCap}
          onPublish={onPublish}
        />
      )}

      {/* Published-assignments manager — only meaningful once there are class
          Sundays to manage against. Keyed to pid so it remounts (and re-fetches)
          on a location switch. */}
      {preview !== null && preview.eligibleSundayCount > 0 && (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em', marginBottom: 4 }}>
            Published assignments
          </h2>
          <p style={{ fontSize: 13, color: 'var(--body-text)', marginBottom: 14, lineHeight: 1.5 }}>
            Move a family to another Sunday, or remove one that has left. Changes are saved immediately.
          </p>
          <AssignmentsManager key={pid} pid={pid} sundays={preview.perSunday.map((s) => s.date)} />
        </section>
      )}
    </div>
  );
}

function EmptyCalendar({ location }: { location: string }) {
  return (
    <div
      data-testid="prasad-preview"
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius, 14px)',
        background: 'var(--surface)',
        padding: '28px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 14,
        boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 46,
          height: 46,
          borderRadius: 12,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--accentSoft)',
          color: 'var(--accentDeep)',
        }}
      >
        <SetuIcon.calendar />
      </span>
      <div>
        <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
          Publish the {location} class calendar first
        </h2>
        <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.55, maxWidth: 460 }}>
          The prasad rotation needs class Sundays to assign families to. There are none for {location} yet — set up the
          school-year Sunday schedule, then come back to assign prasad.
        </p>
      </div>
      <Link
        href="/admin/calendar"
        className="prasad-cta btn btn--p"
        style={{ minHeight: 48, display: 'inline-flex', alignItems: 'center', padding: '0 20px', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
      >
        Go to class calendar →
      </Link>
    </div>
  );
}

function PreviewBody({
  preview,
  publishing,
  loading,
  onCommitCap,
  onPublish,
}: {
  preview: PrasadPreviewResult;
  publishing: boolean;
  loading: boolean;
  onCommitCap: (cap: number) => void;
  onPublish: () => void;
}) {
  const { stats, rows, perSunday, cap } = preview;
  const allAssigned = rows.length === 0 && stats.keptExisting > 0;
  const hasUnplaced = stats.unplaced > 0;

  // Group proposed rows by their Sunday, chronologically. perSunday carries the
  // canonical date ordering (existing + proposed); we only show dates that have
  // NEW proposed rows here (existing ones live in the manager below).
  const rowsByDate = new Map<string, PrasadPreviewResult['rows']>();
  for (const r of rows) {
    const list = rowsByDate.get(r.date) ?? [];
    list.push(r);
    rowsByDate.set(r.date, list);
  }
  const proposedDates = perSunday
    .map((s) => s.date)
    .filter((d) => rowsByDate.has(d));

  return (
    <div data-testid="prasad-preview" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Stat strip — 6 counts. Two rows of three on phones, one row of six on
          wide screens (auto-fit keeps them from cramping). Semantic rails match
          the rollover preview's vocabulary. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }} className="prasad-statgrid">
        <StatBlock value={stats.families} label="families" valueColor="var(--ink)" bg="var(--surface)" rail="var(--line2)" border="var(--line)" />
        <StatBlock value={stats.keptExisting} label="already assigned" valueColor="var(--info-deep)" bg="var(--info-soft)" rail="var(--setu-info, #3a7e88)" border="var(--info-soft)" />
        <StatBlock value={stats.birthdayMonth} label="birthday month" valueColor="var(--accentDeep)" bg="var(--accentSoft)" rail="var(--accent)" border="var(--accentSoft)" />
        <StatBlock value={stats.spill} label="spilled" valueColor="var(--warn, #a06410)" bg="var(--setu-warn-soft)" rail="var(--warn, #a06410)" border="var(--setu-warn-soft)" />
        <StatBlock value={stats.noBirthMonth} label="no birth month" valueColor="var(--muted)" bg="var(--surface2)" rail="var(--line2)" border="var(--line)" />
        <StatBlock value={stats.unplaced} label="unplaced" valueColor={hasUnplaced ? 'var(--err, #a23a2e)' : 'var(--muted)'} bg={hasUnplaced ? 'var(--setu-warn-soft)' : 'var(--surface2)'} rail={hasUnplaced ? 'var(--err, #a23a2e)' : 'var(--line2)'} border={hasUnplaced ? 'var(--setu-warn-soft)' : 'var(--line)'} />
      </div>
      <style>{`
        @media (min-width: 720px) { .prasad-statgrid { grid-template-columns: repeat(6, 1fr) !important; } }
      `}</style>

      {/* Cap control. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          padding: '14px 16px',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radiusSm)',
          background: 'var(--surface)',
        }}
      >
        <CapInput defaultCap={cap} disabled={publishing || loading} onCommit={onCommitCap} />
        <span style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
          {preview.eligibleSundayCount} class Sunday{preview.eligibleSundayCount === 1 ? '' : 's'} available
        </span>
      </div>

      {/* Proposed schedule, or the "all already assigned" plain state. */}
      {allAssigned ? (
        <p
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13.5,
            lineHeight: 1.5,
            padding: '12px 14px',
            borderRadius: 'var(--radiusSm)',
            background: 'var(--info-soft)',
            color: 'var(--info-deep)',
          }}
        >
          <span aria-hidden style={{ flexShrink: 0, fontSize: 14 }}>✓</span>
          All {stats.keptExisting} families already have a Sunday. Manage them below.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
            Proposed schedule
          </p>
          {proposedDates.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>No new families to place at this cap.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {proposedDates.map((d) => (
                <ProposedSundayGroup key={d} date={d} rows={rowsByDate.get(d)!} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Unplaced warning — surfaced both as a banner and as the publish-block
          reason, so the admin knows raising the cap is the fix. */}
      {hasUnplaced && (
        <p
          data-testid="prasad-unplaced-warn"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            lineHeight: 1.5,
            padding: '11px 13px',
            borderRadius: 'var(--radiusSm)',
            background: 'var(--setu-warn-soft)',
            color: 'var(--warn, #a06410)',
          }}
        >
          <span aria-hidden style={{ flexShrink: 0, width: 7, height: 7, borderRadius: '50%', background: 'var(--warn, #a06410)' }} />
          Raise the cap — {stats.unplaced} famil{stats.unplaced === 1 ? 'y doesn’t' : 'ies don’t'} fit.
        </p>
      )}

      <button
        type="button"
        data-testid="prasad-publish"
        onClick={onPublish}
        disabled={publishing || loading || hasUnplaced}
        className="btn btn--p prasad-cta"
        style={{
          width: '100%',
          minHeight: 48,
          fontSize: 15,
          fontWeight: 600,
          opacity: publishing || loading || hasUnplaced ? 0.6 : 1,
        }}
      >
        {publishing ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Spinner /> Publishing…
          </span>
        ) : (
          'Publish schedule'
        )}
      </button>
    </div>
  );
}
