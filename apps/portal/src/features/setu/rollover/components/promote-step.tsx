'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import type { RolloverReport } from '@cmt/shared-domain';
import { previewPromotionClient } from '@/features/setu/rollover/rollover-client';
import { PromotionPreview } from './promotion-preview';
import { Spinner } from './start-step';

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
      style={{
        padding: 20,
        opacity: unlocked ? 1 : 0.85,
        background: unlocked ? 'var(--surface)' : 'var(--surface2)',
        borderStyle: unlocked ? 'solid' : 'dashed',
        borderColor: unlocked ? 'var(--line)' : 'var(--line2)',
        boxShadow: unlocked ? 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))' : 'none',
        transition: 'opacity .2s ease, background .2s ease',
      }}
      aria-disabled={!unlocked}
    >
      <div className="between" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Step 2</p>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: unlocked ? 'var(--ink)' : 'var(--muted)', marginTop: 4, letterSpacing: '-0.01em' }}>Promote families</h2>
        </div>
        {!unlocked && (
          <span
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--muted)',
              background: 'var(--surface)',
              border: '1px solid var(--line2)',
              borderRadius: 999,
              padding: '4px 10px',
              whiteSpace: 'nowrap',
            }}
          >
            <LockGlyph /> Locked
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
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
            padding: '12px 14px',
            borderRadius: 'var(--radiusSm)',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            color: 'var(--muted)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <span aria-hidden style={{ flexShrink: 0, marginTop: 1, color: 'var(--muted)' }}>
            <LockGlyph />
          </span>
          <span>
            Complete Step 1 first to start {toYear}, then you can preview and run the promotion.
          </span>
        </p>
      ) : report ? (
        <div style={{ marginTop: 18 }}>
          <PromotionPreview report={report} committing={committing} onPromote={onPromote} onResolved={preview} />
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <button
              type="button"
              onClick={preview}
              disabled={previewing || committing}
              className="rollover-textbtn"
              style={{
                background: 'transparent',
                border: 0,
                padding: '2px 0',
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--muted)',
                cursor: previewing || committing ? 'default' : 'pointer',
                fontFamily: 'var(--body)',
                opacity: previewing || committing ? 0.6 : 1,
              }}
            >
              {previewing ? 'Refreshing…' : '↻ Refresh preview'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            onClick={preview}
            disabled={previewing}
            className="btn btn--p rollover-cta"
            style={{ minHeight: 46, fontSize: 14.5, fontWeight: 600, width: '100%', maxWidth: 280, opacity: previewing ? 0.7 : 1 }}
          >
            {previewing ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Spinner /> Building preview…
              </span>
            ) : (
              'Preview run'
            )}
          </button>
        </div>
      )}
    </section>
  );
}

/** Minimal lock glyph (inline SVG, currentColor) for the locked Step 2 — reads
 *  as "intentionally disabled", not broken. */
function LockGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: 'block' }}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
