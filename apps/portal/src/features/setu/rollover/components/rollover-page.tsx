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

  return (
    <div style={{ maxWidth: 720 }}>
      <header style={{ marginBottom: 22 }}>
        <Link
          href="/admin"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}
        >
          <SetuIcon.back /> Back to admin
        </Link>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Admin · Bala Vihar</p>
        <h1 style={{ fontSize: 'clamp(26px, 7vw, 36px)', fontWeight: 400, marginTop: 6, lineHeight: 1.12 }}>
          School year rollover
        </h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 600, lineHeight: 1.55 }}>
          Move every Bala Vihar family from {fromYear} into {toYear} — advance grades, re-assign levels, and keep each
          child&rsquo;s history.
        </p>

        {/* Active year → Next year status. Stacks on mobile, side-by-side on desktop. */}
        <div
          style={{
            marginTop: 18,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
            alignItems: 'stretch',
            gap: 10,
          }}
        >
          <YearCard label="Active year" year={fromYear} tone="neutral" />
          <div aria-hidden style={{ alignSelf: 'center', color: 'var(--muted)', fontSize: 18, fontWeight: 600 }}>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <StartStep
          toYear={toYear}
          sourceLevelCount={sourceLevelCount}
          sourceOfferingCount={sourceOfferingCount}
          done={nextYearReady}
          onStarted={() => setStartedThisSession(true)}
        />

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
        background: tone === 'ready' ? 'var(--setu-ok-soft)' : 'var(--surface)',
        border: `1px solid ${tone === 'ready' ? 'var(--ok)' : 'var(--line)'}`,
        borderRadius: 'var(--radiusSm)',
        padding: '12px 14px',
        minWidth: 0,
      }}
    >
      <p style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginTop: 4, fontFamily: 'var(--mono)' }}>{year}</p>
      {status && (
        <p style={{ fontSize: 12, color: tone === 'ready' ? 'var(--ok)' : 'var(--muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }} />
          {status}
        </p>
      )}
    </div>
  );
}
