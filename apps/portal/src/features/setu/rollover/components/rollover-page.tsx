'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast, SetuIcon } from '@cmt/ui';
import type { RolloverReport } from '@cmt/shared-domain';
import { commitPromotionClient } from '@/features/setu/rollover/rollover-client';
import { StartStep } from './start-step';
import { PromoteStep } from './promote-step';
import { PromoteResult } from './promote-result';
import { ConfirmDialog } from './confirm-dialog';

export interface RolloverPageState {
  fromYear: string;
  toYear: string;
  /** True if any target-year BV level already exists (Step 1 ran before). */
  nextYearReady: boolean;
  sourceLevelCount: number;
  sourceOfferingCount: number;
  targetLevelCount: number;
}

type Phase = 'idle' | 'preview' | 'committing' | 'done';

interface RolloverPageProps {
  state: RolloverPageState;
}

/** Owns the 2-step rollover flow state machine. Calls the thin -client fetch
 *  wrappers (so a native app hits the same endpoints) and surfaces every
 *  success/error via Sonner toast. */
export function RolloverPage({ state }: RolloverPageProps) {
  const { fromYear, toYear, sourceLevelCount, sourceOfferingCount } = state;

  const [startedThisSession, setStartedThisSession] = useState(false);
  const [report, setReport] = useState<RolloverReport | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const nextYearReady = state.nextYearReady || startedThisSession;
  const committing = phase === 'committing';

  async function commit() {
    setPhase('committing');
    try {
      const result = await commitPromotionClient();
      setReport(result);
      setConfirmOpen(false);
      setPhase('done');
      toast.success(`${result.promoted} promoted · ${result.graduated} graduated`);
    } catch {
      setPhase('preview');
      toast.error('Promotion failed. No changes were committed — please try again.');
    }
  }

  const startDone = nextYearReady;
  const promoteDone = phase === 'done';

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Scoped rules that inline styles can't express: the in-flight spinner
          keyframes, subtle text-button + CTA hover states, and the responsive
          hide of the numbered step gutter on narrow phones (cards then read
          full-width with no overflow). */}
      <style>{`
        @keyframes rollover-spin { to { transform: rotate(360deg); } }
        .rollover-textbtn:not(:disabled):hover { text-decoration: underline; }
        .rollover-cta:not(:disabled) { transition: background .15s ease, transform .12s ease, box-shadow .15s ease; }
        .rollover-cta:not(:disabled):hover { box-shadow: 0 4px 14px rgba(217,102,66,0.25); }
        .rollover-cta:not(:disabled):active { transform: translateY(1px); }
        .rollover-disclosure { transition: background .15s ease; }
        .rollover-disclosure:hover { background: var(--surface2) !important; }
        .rollover-review { transition: background .15s ease, border-color .15s ease; }
        .rollover-review:hover { background: var(--accentSoft) !important; border-color: var(--accent) !important; }
        @media (prefers-reduced-motion: reduce) {
          .rollover-spin, [style*="rollover-spin"] { animation-duration: 0.01ms !important; }
        }
        @media (max-width: 560px) {
          .rollover-step-gutter { display: none !important; }
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
          School year rollover
        </h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 600, lineHeight: 1.55 }}>
          Move every Bala Vihar family from {fromYear} into {toYear} — advance grades, re-assign levels, and keep each
          child&rsquo;s history.
        </p>

        {/* Active year → Next year status. A single banded panel so the two-step
            journey reads as one continuous arc. The two short year codes sit
            side-by-side with the arrow between them on every viewport (they fit
            without overflow even on narrow phones); the arrow recolours to ok
            once next year is ready. */}
        <div
          style={{
            marginTop: 18,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
            alignItems: 'stretch',
            gap: 10,
            padding: 10,
            borderRadius: 'var(--radius, 14px)',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
          }}
        >
          <YearCard label="Active year" year={fromYear} tone="neutral" />
          <div
            aria-hidden
            style={{
              alignSelf: 'center',
              color: nextYearReady ? 'var(--ok)' : 'var(--muted)',
              fontSize: 20,
              fontWeight: 600,
              transition: 'color .2s ease',
            }}
          >
            →
          </div>
          <YearCard
            label="Next year"
            year={toYear}
            tone={nextYearReady ? 'ready' : 'pending'}
            status={nextYearReady ? 'Ready' : 'Not started yet'}
          />
        </div>
      </header>

      {/* Numbered step rail — a vertical connector ties Step 1 → Step 2 so the
          flow reads as an ordered sequence, not two loose cards. The numbered
          node turns accent (active) → ok (done); the spine fills as Step 1
          completes. The gutter collapses on narrow phones so cards keep their
          width. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <StepRow index={1} done={startDone} active={!startDone} spineDone={startDone}>
          <StartStep
            toYear={toYear}
            sourceLevelCount={sourceLevelCount}
            sourceOfferingCount={sourceOfferingCount}
            done={nextYearReady}
            onStarted={() => setStartedThisSession(true)}
          />
        </StepRow>

        <StepRow index={2} done={promoteDone} active={startDone && !promoteDone} last>
          {phase === 'done' && report ? (
            <PromoteResult
              report={report}
              onReRunPreview={(next) => {
                setReport(next);
                setPhase('preview');
              }}
            />
          ) : (
            <PromoteStep
              fromYear={fromYear}
              toYear={toYear}
              unlocked={nextYearReady}
              report={report}
              committing={committing}
              onReport={(next) => {
                setReport(next);
                setPhase('preview');
              }}
              onPromote={() => setConfirmOpen(true)}
            />
          )}
        </StepRow>
      </div>

      {confirmOpen && report && (
        <ConfirmDialog
          promoted={report.promoted}
          fromYear={fromYear}
          toYear={toYear}
          busy={committing}
          onConfirm={commit}
          onCancel={() => {
            if (!committing) setConfirmOpen(false);
          }}
        />
      )}
    </div>
  );
}

function YearCard({
  label,
  year,
  tone,
  status,
}: {
  label: string;
  year: string;
  tone: 'neutral' | 'ready' | 'pending';
  status?: string;
}) {
  const dotColor = tone === 'ready' ? 'var(--ok)' : tone === 'pending' ? 'var(--muted)' : 'transparent';
  return (
    <div
      style={{
        background: tone === 'ready' ? 'var(--setu-ok-soft)' : 'var(--surface2)',
        border: `1px solid ${tone === 'ready' ? 'var(--ok)' : 'var(--line)'}`,
        borderRadius: 'var(--radiusSm)',
        padding: '12px 14px',
        minWidth: 0,
      }}
    >
      <p style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', marginTop: 4, fontFamily: 'var(--mono)', letterSpacing: '-0.01em' }}>{year}</p>
      {status && (
        <p style={{ fontSize: 12, fontWeight: 500, color: tone === 'ready' ? 'var(--ok)' : 'var(--muted)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }} />
          {status}
        </p>
      )}
    </div>
  );
}

/** One row of the numbered step rail: a left gutter holding a numbered node +
 *  vertical connector spine, and the card content beside it. The gutter is
 *  hidden on narrow phones (the in-card copy is self-explanatory there) so the
 *  cards keep full width and never overflow. */
function StepRow({
  index,
  done,
  active,
  last = false,
  spineDone = false,
  children,
}: {
  index: number;
  done: boolean;
  active: boolean;
  last?: boolean;
  spineDone?: boolean;
  children: React.ReactNode;
}) {
  const nodeBg = done ? 'var(--ok)' : active ? 'var(--accent)' : 'var(--surface)';
  const nodeColor = done || active ? '#fff' : 'var(--muted)';
  const nodeBorder = done ? 'var(--ok)' : active ? 'var(--accent)' : 'var(--line2)';
  return (
    <div style={{ display: 'flex', gap: 16 }}>
      {/* Gutter: desktop-only numbered node + spine. */}
      <div
        aria-hidden
        className="rollover-step-gutter"
        style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', width: 30 }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: 14,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            background: nodeBg,
            color: nodeColor,
            border: `1.5px solid ${nodeBorder}`,
            boxShadow: active ? '0 0 0 4px var(--accentSoft)' : 'none',
            transition: 'background .2s ease, color .2s ease, border-color .2s ease, box-shadow .2s ease',
          }}
        >
          {done ? '✓' : index}
        </span>
        {!last && (
          <span
            style={{
              flex: 1,
              width: 2,
              marginTop: 6,
              borderRadius: 999,
              background: spineDone ? 'var(--ok)' : 'var(--line)',
              transition: 'background .2s ease',
            }}
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
