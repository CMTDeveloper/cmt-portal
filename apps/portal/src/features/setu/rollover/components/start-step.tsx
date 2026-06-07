'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import { startNewYearClient } from '@/features/setu/rollover/rollover-client';

interface StartStepProps {
  toYear: string;
  sourceLevelCount: number;
  sourceOfferingCount: number;
  /** True once Step 1 has been completed (either pre-existing or this session). */
  done: boolean;
  /** Fires after a successful start so the parent can unlock Step 2. */
  onStarted: () => void;
}

/** Step 1 — clone this year's levels + offerings into next year. Idempotent on
 *  the server; the "Re-sync" link re-runs it without clobbering teacher
 *  assignments (skip-existing on the engine side). */
export function StartStep({ toYear, sourceLevelCount, sourceOfferingCount, done, onStarted }: StartStepProps) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const result = await startNewYearClient();
      const created = result.levelsCreated.length;
      const existing = result.levelsExisting.length;
      toast.success(
        created > 0
          ? `${toYear} ready · ${created} level${created === 1 ? '' : 's'} created`
          : `${toYear} already in sync · ${existing} level${existing === 1 ? '' : 's'} kept`,
      );
      onStarted();
    } catch {
      toast.error('Could not start the new year. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="card"
      style={{
        padding: 20,
        borderColor: done ? 'var(--ok)' : 'var(--line)',
        boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
        transition: 'border-color .2s ease',
      }}
    >
      <div className="between" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Step 1</p>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginTop: 4, letterSpacing: '-0.01em' }}>Start {toYear}</h2>
        </div>
        <StatusDot done={done} />
      </div>

      <p style={{ fontSize: 13.5, color: 'var(--body-text)', marginTop: 10, lineHeight: 1.55, maxWidth: 560 }}>
        Copies this year&rsquo;s levels and class offerings into next year. Grade bands and curriculum carry over;
        teacher assignments start empty so you can re-assign.
      </p>

      {done ? (
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            padding: '12px 14px',
            borderRadius: 'var(--radiusSm)',
            background: 'var(--setu-ok-soft)',
            color: 'var(--ok)',
          }}
        >
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              width: 22,
              height: 22,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              background: 'var(--ok)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            ✓
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1, minWidth: 0 }}>
            {toYear} is ready. Levels and offerings are in place.
          </span>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="rollover-textbtn"
            style={{
              background: 'transparent',
              border: 0,
              padding: '2px 0',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--accentDeep)',
              cursor: busy ? 'default' : 'pointer',
              fontFamily: 'var(--body)',
              opacity: busy ? 0.6 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {busy ? 'Re-syncing…' : 'Re-sync'}
          </button>
        </div>
      ) : (
        <>
          <div
            style={{
              margin: '16px 0 0',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
            }}
          >
            <PlanStat value={sourceLevelCount} label="levels to create" />
            <PlanStat value={sourceOfferingCount} label="offerings to create" />
          </div>
          <div style={{ marginTop: 18 }}>
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="btn btn--p rollover-cta"
              style={{ minHeight: 46, fontSize: 14.5, fontWeight: 600, width: '100%', maxWidth: 280, opacity: busy ? 0.7 : 1 }}
            >
              {busy ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Spinner /> Starting…
                </span>
              ) : (
                `Start ${toYear}`
              )}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** A small "what this will create" chip — number-forward so the scope of Step 1
 *  is legible at a glance before running it. */
function PlanStat({ value, label }: { value: number; label: string }) {
  return (
    <div
      style={{
        background: 'var(--surface2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radiusSm)',
        padding: '11px 13px',
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', lineHeight: 1, letterSpacing: '-0.02em', display: 'block' }}>
        {value}
      </span>
      <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.3, marginTop: 4, display: 'block' }}>{label}</span>
    </div>
  );
}

/** Tiny spinning ring for in-flight CTA affordance. Token-driven, no deps. */
export function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.4)',
        borderTopColor: '#fff',
        display: 'inline-block',
        animation: 'rollover-spin .6s linear infinite',
      }}
    />
  );
}

function StatusDot({ done }: { done: boolean }) {
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
        background: done ? 'var(--ok)' : 'var(--surface2)',
        color: done ? '#fff' : 'var(--muted)',
        border: done ? 'none' : '1px solid var(--line2)',
      }}
    >
      {done ? '✓' : ''}
    </span>
  );
}
