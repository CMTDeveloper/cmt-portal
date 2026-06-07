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
    <section className="card" style={{ padding: 22, borderColor: 'var(--ok)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: 40,
            height: 40,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--setu-ok-soft)',
            color: 'var(--ok)',
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          ✓
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 19, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Promotion complete
          </h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Everyone has moved into {toYear}.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 18 }}>
        <ResultStat value={promoted} label="promoted" />
        <ResultStat value={graduated} label="graduated" />
        <ResultStat value={familiesSkippedAlreadyPromoted} label="skipped" />
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
          className="btn btn--p"
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

function ResultStat({ value, label }: { value: number; label: string }) {
  return (
    <div
      style={{
        background: 'var(--surface2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radiusSm)',
        padding: '12px 10px',
        textAlign: 'center',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', lineHeight: 1, letterSpacing: '-0.03em' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{label}</div>
    </div>
  );
}
