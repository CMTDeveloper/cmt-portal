'use client';

import type { YearReadiness } from '@cmt/shared-domain';
import { Spinner } from './start-step';

interface YearReadinessChecklistProps {
  readiness: YearReadiness;
  onActivate: () => void;
  onCopyCalendar: () => void;
  activating: boolean;
  copyingCalendar?: boolean;
}

const ITEMS: { key: keyof Omit<YearReadiness, 'toYear' | 'promotionRan'>; label: string }[] = [
  { key: 'offerings', label: 'Offerings' },
  { key: 'levels', label: 'Levels' },
  { key: 'calendar', label: 'Class calendar' },
  { key: 'teachers', label: 'Teachers' },
  { key: 'prasad', label: 'Prasad' },
  { key: 'seva', label: 'Seva' },
];

/** Step 3 — Year center. A readiness checklist for the SIX next-year setup pieces
 *  plus an admin Activate button gated on the promotion having run. The calendar
 *  row carries a "Copy from last year" shortcut. Mirrors start-step.tsx's card +
 *  ✓-chip visual idiom (inline styles, .csp tokens). */
export function YearReadinessChecklist({
  readiness,
  onActivate,
  onCopyCalendar,
  activating,
  copyingCalendar = false,
}: YearReadinessChecklistProps) {
  const canActivate = readiness.promotionRan;

  return (
    <section
      className="card"
      style={{
        padding: 20,
        borderColor: canActivate ? 'var(--ok)' : 'var(--line)',
        boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
        transition: 'border-color .2s ease',
      }}
    >
      <div className="between" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Step 3</p>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginTop: 4, letterSpacing: '-0.01em' }}>
            {readiness.toYear} readiness
          </h2>
        </div>
      </div>

      <p style={{ fontSize: 13.5, color: 'var(--body-text)', marginTop: 10, lineHeight: 1.55, maxWidth: 560 }}>
        Make sure next year is fully set up, then make it the live school year.
      </p>

      <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {ITEMS.map(({ key, label }) => {
          const ok = readiness[key];
          return (
            <li
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 2px',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <StatusChip ok={ok} />
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', flex: 1, minWidth: 0 }}>{label}</span>
              {key === 'calendar' && (
                <button
                  type="button"
                  onClick={onCopyCalendar}
                  disabled={copyingCalendar}
                  className="rollover-textbtn"
                  style={{
                    background: 'transparent',
                    border: 0,
                    padding: '2px 0',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--accentDeep)',
                    cursor: copyingCalendar ? 'default' : 'pointer',
                    fontFamily: 'var(--body)',
                    opacity: copyingCalendar ? 0.6 : 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {copyingCalendar ? 'Copying…' : 'Copy from last year'}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div style={{ marginTop: 18 }}>
        <button
          type="button"
          onClick={onActivate}
          disabled={!canActivate || activating}
          className="btn btn--p rollover-cta"
          style={{
            minHeight: 46,
            fontSize: 14.5,
            fontWeight: 600,
            width: '100%',
            maxWidth: 280,
            opacity: !canActivate || activating ? 0.6 : 1,
            cursor: !canActivate || activating ? 'not-allowed' : 'pointer',
          }}
        >
          {activating ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Spinner /> Activating…
            </span>
          ) : (
            `Activate ${readiness.toYear}`
          )}
        </button>
        {!canActivate && (
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
            Promote families before activating.
          </p>
        )}
      </div>
    </section>
  );
}

/** ✓ when ready (ok green), ○ when not (muted) — mirrors start-step's chip. */
function StatusChip({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: 22,
        height: 22,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        fontSize: 12,
        fontWeight: 700,
        background: ok ? 'var(--ok)' : 'var(--surface2)',
        color: ok ? '#fff' : 'var(--muted)',
        border: ok ? 'none' : '1px solid var(--line2)',
      }}
    >
      {ok ? '✓' : '○'}
    </span>
  );
}
