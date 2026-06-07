'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import type { RolloverReport } from '@cmt/shared-domain';
import { previewPromotionClient } from '@/features/setu/rollover/rollover-client';
import { PromotionPreview } from './promotion-preview';

interface PromoteStepProps {
  fromYear: string;
  toYear: string;
  /** Step 2 stays locked until Step 1 completes. */
  unlocked: boolean;
  /** Latest dry-run report (null until previewed). */
  report: RolloverReport | null;
  committing: boolean;
  onReport: (report: RolloverReport) => void;
  onPromote: () => void;
}

/** Step 2 — preview (dry-run) then promote. Locked until Step 1 is done. */
export function PromoteStep({ fromYear, toYear, unlocked, report, committing, onReport, onPromote }: PromoteStepProps) {
  const [previewing, setPreviewing] = useState(false);

  async function preview() {
    setPreviewing(true);
    try {
      const next = await previewPromotionClient();
      onReport(next);
    } catch {
      toast.error('Preview failed. Please try again.');
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <section
      className="card"
      style={{ padding: 20, opacity: unlocked ? 1 : 0.72 }}
      aria-disabled={!unlocked}
    >
      <div className="between" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>Step 2</p>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginTop: 4 }}>Promote families</h2>
        </div>
        {!unlocked && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--muted)',
              background: 'var(--surface2)',
              border: '1px solid var(--line2)',
              borderRadius: 999,
              padding: '3px 9px',
              whiteSpace: 'nowrap',
            }}
          >
            Locked
          </span>
        )}
      </div>

      <p style={{ fontSize: 13.5, color: 'var(--body-text)', marginTop: 10, lineHeight: 1.55, maxWidth: 560 }}>
        Advances every child one grade, moves them into next year&rsquo;s level, and closes their {fromYear} record
        (kept as history). Graduating Grade 12 students complete the program.
      </p>

      {!unlocked ? (
        <p
          style={{
            marginTop: 16,
            padding: '12px 14px',
            borderRadius: 'var(--radiusSm)',
            background: 'var(--surface2)',
            color: 'var(--muted)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          Complete Step 1 first to start {toYear}, then you can preview and run the promotion.
        </p>
      ) : report ? (
        <div style={{ marginTop: 18 }}>
          <PromotionPreview report={report} committing={committing} onPromote={onPromote} />
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button
              type="button"
              onClick={preview}
              disabled={previewing || committing}
              style={{
                background: 'transparent',
                border: 0,
                padding: 0,
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--muted)',
                cursor: previewing || committing ? 'default' : 'pointer',
                fontFamily: 'var(--body)',
                opacity: previewing || committing ? 0.6 : 1,
              }}
            >
              {previewing ? 'Refreshing…' : 'Refresh preview'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            onClick={preview}
            disabled={previewing}
            className="btn btn--p"
            style={{ minHeight: 46, fontSize: 14.5, fontWeight: 600, width: '100%', maxWidth: 280, opacity: previewing ? 0.65 : 1 }}
          >
            {previewing ? 'Building preview…' : 'Preview run'}
          </button>
        </div>
      )}
    </section>
  );
}
