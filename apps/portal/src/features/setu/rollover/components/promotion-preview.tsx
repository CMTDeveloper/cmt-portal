'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { RolloverReport, PromotionRow } from '@cmt/shared-domain';

interface PromotionPreviewProps {
  report: RolloverReport;
  committing: boolean;
  onPromote: () => void;
}

/** Big scannable metric. Mobile: the trio is a 3-col grid that never overflows
 *  (min 0, ellipsis labels) — no horizontal scroll. */
function StatBlock({
  value,
  label,
  valueColor,
  bg,
  sub,
}: {
  value: number;
  label: string;
  valueColor: string;
  bg: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        background: bg,
        border: '1px solid var(--line)',
        borderRadius: 'var(--radiusSm)',
        padding: '14px 12px',
        textAlign: 'center',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <span style={{ fontSize: 32, fontWeight: 700, color: valueColor, lineHeight: 1, letterSpacing: '-0.03em' }}>
        {value}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--body-text)', lineHeight: 1.25 }}>{label}</span>
      {sub && <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.3 }}>{sub}</span>}
    </div>
  );
}

/** A from→to transition row with a proportional bar so the two-grades-per-level
 *  split is visible at a glance. Bar width = count / maxCount. */
function TransitionRow({ label, count, maxCount }: { label: string; count: number; maxCount: number }) {
  const pct = maxCount > 0 ? Math.max(6, Math.round((count / maxCount) * 100)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0' }}>
      <span
        style={{
          fontSize: 13.5,
          color: 'var(--ink)',
          flex: '1 1 0',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>
        {count}
      </span>
      <span
        aria-hidden
        style={{
          flex: '0 0 38%',
          maxWidth: 160,
          height: 8,
          borderRadius: 999,
          background: 'var(--surface2)',
          overflow: 'hidden',
        }}
      >
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 999 }} />
      </span>
    </div>
  );
}

/** Collapsible disclosure section (graduating / need-attention). */
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
        <span aria-hidden style={{ color: 'var(--muted)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease', display: 'inline-block' }}>
          ▸
        </span>
        <span style={{ flex: 1 }}>
          {title} ({count})
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

export function PromotionPreview({ report, committing, onPromote }: PromotionPreviewProps) {
  const { promoted, graduated, needsAttention, shishuStayed, byTransition, graduates, attention, fromYear, toYear } = report;
  const maxCount = byTransition.reduce((m, t) => Math.max(m, t.count), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
          Promotion preview · {fromYear} → {toYear}
        </h3>
      </div>

      {/* Three big scannable counts — a 3-col grid on every viewport (no scroll). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <StatBlock
          value={promoted}
          label="moving up"
          valueColor="var(--accentDeep)"
          bg="var(--accentSoft)"
          {...(shishuStayed > 0 ? { sub: `incl. ${shishuStayed} Shishu continuing` } : {})}
        />
        <StatBlock value={graduated} label="graduate" valueColor="var(--info-deep)" bg="var(--info-soft)" />
        <StatBlock value={needsAttention} label="need attention" valueColor="var(--warn, #a06410)" bg="var(--setu-warn-soft)" />
      </div>

      {/* Where students move — proportional transition bars. */}
      {byTransition.length > 0 && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)', marginBottom: 4 }}>
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
        <Disclosure title="Need attention" count={needsAttention} defaultOpen>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {attention.map((row) => (
              <li
                key={row.mid}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{row.childName}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--warn, #a06410)' }}>{attentionReason(row)}</span>
                </span>
                <Link
                  href={`/welcome/family/${row.fid}/members/${row.mid}`}
                  style={{ fontSize: 13, fontWeight: 600, color: 'var(--accentDeep)', textDecoration: 'none', whiteSpace: 'nowrap' }}
                >
                  Review →
                </Link>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
        Nothing has changed yet. Review, then confirm below.
      </p>

      <button
        type="button"
        onClick={onPromote}
        disabled={committing || promoted === 0}
        className="btn btn--p"
        style={{
          width: '100%',
          minHeight: 48,
          fontSize: 15,
          fontWeight: 600,
          opacity: committing || promoted === 0 ? 0.6 : 1,
        }}
      >
        {promoted === 0 ? 'Nothing to promote' : `Promote ${promoted} students →`}
      </button>
    </div>
  );
}
