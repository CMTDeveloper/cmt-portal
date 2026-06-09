'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from '@cmt/ui';
import { GRADE_LADDER, type RolloverReport, type PromotionRow } from '@cmt/shared-domain';
import { setGradeClient } from '../set-grade-client';
import { Spinner } from './start-step';

interface PromotionPreviewProps {
  report: RolloverReport;
  committing: boolean;
  onPromote: () => void;
  /** Re-runs the dry-run preview after a row is resolved (set grade succeeds),
   *  so the just-fixed child drops out of "Need attention". Wired to the same
   *  handler as the "Refresh preview" affordance. */
  onResolved: () => void;
}

/** Big scannable metric. A top accent rail + semantic fill makes each count's
 *  meaning legible at a glance (moving-up = accent, graduate = info, attention =
 *  warn). Mobile: the trio is a 3-col grid that never overflows (min 0, ellipsis
 *  labels) — no horizontal scroll. */
function StatBlock({
  value,
  label,
  valueColor,
  bg,
  rail,
  border,
  sub,
}: {
  value: number;
  label: string;
  valueColor: string;
  bg: string;
  rail: string;
  border: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 'var(--radiusSm)',
        padding: 0,
        textAlign: 'center',
        minWidth: 0,
        overflow: 'hidden',
        boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
      }}
    >
      <span aria-hidden style={{ display: 'block', height: 3, background: rail }} />
      <span
        style={{
          padding: '14px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 'clamp(28px, 9vw, 34px)', fontWeight: 700, color: valueColor, lineHeight: 1, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--body-text)', lineHeight: 1.25 }}>{label}</span>
        {sub && (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 500,
              color: valueColor,
              lineHeight: 1.3,
              marginTop: 1,
              opacity: 0.92,
            }}
          >
            {sub}
          </span>
        )}
      </span>
    </div>
  );
}

/** A from→to transition row with a proportional bar so the two-grades-per-level
 *  split is visible at a glance. The label sits on its own line above a full-width
 *  track with an accent fill ending in the count — so each bar's length and its
 *  number read as one unit, aligned left edge to left edge across all rows. Bar
 *  width = count / maxCount. */
function TransitionRow({ label, count, maxCount }: { label: string; count: number; maxCount: number }) {
  const pct = maxCount > 0 ? Math.max(7, Math.round((count / maxCount) * 100)) : 0;
  return (
    <div style={{ padding: '6px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            color: 'var(--ink)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {count}
        </span>
      </div>
      <span
        aria-hidden
        style={{
          display: 'block',
          height: 8,
          borderRadius: 999,
          background: 'var(--accentSoft)',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${pct}%`,
            background: 'var(--accent)',
            borderRadius: 999,
            transition: 'width .3s ease',
          }}
        />
      </span>
    </div>
  );
}

/** Collapsible disclosure section (graduating / need-attention). The chevron
 *  rotates on open and the header tints on hover. An optional tone adds a small
 *  leading status dot (warn for the attention list). The count stays inside the
 *  single title text node — "Title (N)" — so it reads as one label and does not
 *  collide with the standalone stat-card numbers. */
function Disclosure({
  title,
  count,
  defaultOpen = false,
  tone = 'neutral',
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  tone?: 'neutral' | 'warn';
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const dotColor = tone === 'warn' ? 'var(--warn, #a06410)' : 'var(--muted)';
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', overflow: 'hidden', background: 'var(--surface)' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rollover-disclosure"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          fontFamily: 'var(--body)',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--ink)',
          textAlign: 'left',
        }}
      >
        {tone === 'warn' && (
          <span aria-hidden style={{ flexShrink: 0, width: 7, height: 7, borderRadius: '50%', background: dotColor }} />
        )}
        <span style={{ flex: 1 }}>
          {title} ({count})
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
      {open && <div style={{ padding: '0 14px 14px' }}>{children}</div>}
    </div>
  );
}

/** Map an attention row's outcome to a short, human reason. */
function attentionReason(row: PromotionRow): string {
  switch (row.outcomeKind) {
    case 'needs-grade':
      return 'no grade set';
    case 'shishu-aged-out':
      return 'aged out of Shishu';
    default:
      return 'needs review';
  }
}

/** Inline grade picker for a single need-attention row. A mist-surface select
 *  (placeholder + GRADE_LADDER rungs) paired with an accent "Save" pill, both
 *  ≥44px tall so they stay comfortable tap targets on mobile and wrap onto
 *  their own line under the child's name on a narrow row. Saving writes the
 *  grade through the admin endpoint, toasts, then calls onResolved() so the
 *  fixed child leaves the list on the refreshed preview.
 *
 *  Module-scope (not nested in PromotionPreview) so its <select> never remounts
 *  and lose focus/selection on a parent re-render. */
function SetGradeControl({
  fid,
  mid,
  childName,
  onResolved,
  disabled,
}: {
  fid: string;
  mid: string;
  childName: string;
  onResolved: () => void;
  disabled: boolean;
}) {
  const [grade, setGrade] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = saving || disabled;

  async function save() {
    if (!grade || saving) return;
    setSaving(true);
    try {
      // grade is one of GRADE_LADDER (the only options rendered), which is the
      // SetMemberGradeBody.schoolGrade enum the endpoint validates against.
      await setGradeClient({ fid, mid, schoolGrade: grade as (typeof GRADE_LADDER)[number] });
      toast.success(`Grade set for ${childName}`);
      onResolved();
    } catch {
      toast.error('Could not set grade. Please try again.');
      setSaving(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <select
        aria-label={`Set grade for ${childName}`}
        value={grade}
        disabled={busy}
        onChange={(e) => setGrade(e.target.value)}
        className="rollover-grade-select"
        style={{
          minHeight: 44,
          padding: '0 28px 0 11px',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'var(--body)',
          color: grade ? 'var(--ink)' : 'var(--muted)',
          background: 'var(--surface)',
          border: '1px solid var(--line2)',
          borderRadius: 999,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
          // Native chevron via a token-coloured SVG so the pill reads as part of
          // the Cool-Mist set, not a default OS control.
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
          Set grade…
        </option>
        {GRADE_LADDER.map((g) => (
          <option key={g} value={g}>
            {/^\d/.test(g) ? `Grade ${g}` : g}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={save}
        disabled={busy || !grade}
        aria-label={`Save grade for ${childName}`}
        className="rollover-grade-save"
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
          cursor: busy || !grade ? 'default' : 'pointer',
          opacity: busy || !grade ? 0.55 : 1,
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
    </span>
  );
}

export function PromotionPreview({ report, committing, onPromote, onResolved }: PromotionPreviewProps) {
  const { promoted, graduated, needsAttention, shishuStayed, byTransition, graduates, attention, fromYear, toYear } = report;
  const maxCount = byTransition.reduce((m, t) => Math.max(m, t.count), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          Promotion preview · {fromYear} → {toYear}
        </h3>
      </div>

      {/* Three big scannable counts — a 3-col grid on every viewport (no scroll).
          Each carries a semantic accent rail: moving-up = accent, graduate =
          info, attention = warn. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <StatBlock
          value={promoted}
          label="moving up"
          valueColor="var(--accentDeep)"
          bg="var(--accentSoft)"
          rail="var(--accent)"
          border="var(--accentSoft)"
          {...(shishuStayed > 0 ? { sub: `incl. ${shishuStayed} Shishu continuing` } : {})}
        />
        <StatBlock
          value={graduated}
          label="graduate"
          valueColor="var(--info-deep)"
          bg="var(--info-soft)"
          rail="var(--setu-info, #3a7e88)"
          border="var(--info-soft)"
        />
        <StatBlock
          value={needsAttention}
          label="need attention"
          valueColor="var(--warn, #a06410)"
          bg="var(--setu-warn-soft)"
          rail="var(--warn, #a06410)"
          border="var(--setu-warn-soft)"
        />
      </div>

      {/* Where students move — proportional transition bars in a quiet panel so
          the two-grades-per-level split reads as one grouped trust-builder. */}
      {byTransition.length > 0 && (
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--radiusSm)',
            background: 'var(--surface)',
            padding: '14px 16px',
          }}
        >
          <p style={{ fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 8 }}>
            Where students move
          </p>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {byTransition.map((t) => (
              <TransitionRow key={t.label} label={t.label} count={t.count} maxCount={maxCount} />
            ))}
          </div>
        </div>
      )}

      {/* Graduating — collapsible roster of graduates. */}
      {graduated > 0 && (
        <Disclosure title="Graduating" count={graduated}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
            {graduates.map((g) => (
              <li key={g.mid} style={{ fontSize: 13.5, color: 'var(--body-text)' }}>
                {g.childName}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {/* Need attention — each row deep-links to the child's profile so an admin
          can review before committing. We link to the welcome member detail
          (/welcome/family/{fid}/members/{mid}) because admins inherit welcome-team
          and can open it; it is READ-ONLY there, so the link is labelled
          "Review →" (not "Fix →"). */}
      {needsAttention > 0 && (
        <Disclosure title="Need attention" count={needsAttention} tone="warn" defaultOpen>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {attention.map((row) => (
              <li
                key={row.mid}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  padding: '9px 11px',
                  borderRadius: 'var(--radiusSm)',
                  background: 'var(--setu-warn-soft)',
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.childName}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--warn, #a06410)' }}>{attentionReason(row)}</span>
                </span>
                {/* Actions: fix in place (inline grade picker) or open the full
                    profile. The group wraps to its own line under the name on a
                    narrow row (the parent <li> is flexWrap:'wrap'); both controls
                    are ≥44px tap targets. */}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
                  <SetGradeControl
                    fid={row.fid}
                    mid={row.mid}
                    childName={row.childName}
                    onResolved={onResolved}
                    disabled={committing}
                  />
                  <Link
                    href={`/welcome/family/${row.fid}/members/${row.mid}`}
                    className="rollover-review"
                    style={{
                      flexShrink: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      minHeight: 44,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: 'var(--accentDeep)',
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                      padding: '0 13px',
                      borderRadius: 999,
                      background: 'var(--surface)',
                      border: '1px solid var(--line2)',
                    }}
                  >
                    Review →
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      <p
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12.5,
          lineHeight: 1.5,
          padding: '10px 12px',
          borderRadius: 'var(--radiusSm)',
          background: 'var(--info-soft)',
          color: 'var(--info-deep)',
        }}
      >
        <span aria-hidden style={{ flexShrink: 0, fontSize: 14 }}>👁</span>
        Nothing has changed yet — this is a preview. Review, then confirm below.
      </p>

      <button
        type="button"
        onClick={onPromote}
        disabled={committing || promoted === 0}
        className="btn btn--p rollover-cta"
        style={{
          width: '100%',
          minHeight: 48,
          fontSize: 15,
          fontWeight: 600,
          opacity: committing || promoted === 0 ? 0.6 : 1,
        }}
      >
        {committing ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Spinner /> Promoting…
          </span>
        ) : promoted === 0 ? (
          'Nothing to promote'
        ) : (
          `Promote ${promoted} students →`
        )}
      </button>
    </div>
  );
}
