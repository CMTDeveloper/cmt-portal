'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from '@cmt/ui';
import type { RolloverReport } from '@cmt/shared-domain';
import { previewPromotionClient } from '@/features/setu/rollover/rollover-client';

interface PromoteResultProps {
  report: RolloverReport;
  /** Replace the result with a fresh dry-run (idempotency check → expects ~0). */
  onReRunPreview: (report: RolloverReport) => void;
}

/** Past-tense result after a committed promotion. Same three numbers, plus a
 *  roster link and an idempotency re-check. */
export function PromoteResult({ report, onReRunPreview }: PromoteResultProps) {
  const { promoted, graduated, familiesSkippedAlreadyPromoted, toYear } = report;
  const [busy, setBusy] = useState(false);

  async function reRun() {
    setBusy(true);
    try {
      const next = await previewPromotionClient();
      onReRunPreview(next);
      toast.success(next.promoted === 0 ? 'All families are already on the new year.' : 'Preview refreshed.');
    } catch {
      toast.error('Could not re-run the preview.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="card"
      style={{
        padding: 24,
        borderColor: 'var(--ok)',
        background: 'linear-gradient(180deg, var(--setu-ok-soft) 0%, var(--surface) 64px)',
        boxShadow: 'var(--setu-elev-2, 0 4px 14px rgba(15,26,34,0.06))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--ok)',
            color: '#fff',
            fontSize: 22,
            fontWeight: 700,
            boxShadow: '0 0 0 5px var(--setu-ok-soft)',
          }}
        >
          ✓
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
            Promotion complete
          </h2>
          <p style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 3 }}>Everyone has moved into {toYear}.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 20 }}>
        <ResultStat value={promoted} label="promoted" tone="ok" />
        <ResultStat value={graduated} label="graduated" tone="info" />
        <ResultStat value={familiesSkippedAlreadyPromoted} label="skipped" tone="neutral" />
      </div>

      <div
        style={{
          marginTop: 20,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        {/* Admin-sensible destination: the levels & teachers screen shows the
            new-year rosters per level (admins manage levels there). */}
        <Link
          href="/admin/levels"
          className="btn btn--p rollover-cta"
          style={{ flex: '1 1 200px', minHeight: 46, fontSize: 14.5, fontWeight: 600, textAlign: 'center', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        >
          View {toYear} rosters →
        </Link>
        <button
          type="button"
          onClick={reRun}
          disabled={busy}
          className="btn btn--g"
          style={{ flex: '1 1 160px', minHeight: 46, fontSize: 14.5, fontWeight: 500, opacity: busy ? 0.65 : 1 }}
        >
          {busy ? 'Re-running…' : 'Re-run preview'}
        </button>
      </div>
    </section>
  );
}

function ResultStat({ value, label, tone }: { value: number; label: string; tone: 'ok' | 'info' | 'neutral' }) {
  const railColor =
    tone === 'ok' ? 'var(--ok)' : tone === 'info' ? 'var(--setu-info, #3a7e88)' : 'var(--line2)';
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radiusSm)',
        overflow: 'hidden',
        textAlign: 'center',
        minWidth: 0,
        boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
      }}
    >
      <span aria-hidden style={{ display: 'block', height: 3, background: railColor }} />
      <div style={{ padding: '12px 10px' }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', lineHeight: 1, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 5 }}>{label}</div>
      </div>
    </div>
  );
}
