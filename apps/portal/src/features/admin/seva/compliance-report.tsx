'use client';

import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import type { ComplianceRow, SevaComplianceData } from './compliance-client';

interface ComplianceReportProps {
  initial: SevaComplianceData;
}

// ─── shared styles ─────────────────────────────────────────────────────────────

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  fontWeight: 600,
};

// ─── main component ────────────────────────────────────────────────────────────

export function ComplianceReport({ initial }: ComplianceReportProps) {
  const { currentSevaYear, hoursPerYear, rows, summary } = initial;
  const hasYear = currentSevaYear != null && currentSevaYear !== '';
  // "Short" is the actionable number; lead the eye to it only when there's work to do.
  const hasShort = summary.shortCount > 0;
  const allClear = summary.totalFamilies > 0 && summary.shortCount === 0;

  return (
    <>
      {/* Header */}
      <header style={{ marginBottom: 22 }}>
        <p style={eyebrowStyle}>Seva</p>
        <h1 style={{ fontSize: 'clamp(26px, 6.5vw, 36px)', fontWeight: 400, marginTop: 8, lineHeight: 1.1 }}>
          Compliance
        </h1>
        {hasYear ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 10,
              marginTop: 12,
              fontSize: 13.5,
              color: 'var(--body-text)',
            }}
          >
            <span
              className="pill"
              style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', fontWeight: 600 }}
            >
              {currentSevaYear}
            </span>
            <span aria-hidden style={{ color: 'var(--line2)' }}>·</span>
            <span>{hoursPerYear} hrs / family / year</span>
          </div>
        ) : null}
      </header>

      {hasYear ? (
        <>
          {/* Stat strip — Total / Met / Short at a glance. The Short column gets the
              soft accent wash only when there are families to nudge. */}
          <div
            className="card"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              marginBottom: 18,
              overflow: 'hidden',
            }}
          >
            {renderStat('Total', summary.totalFamilies, 'var(--ink)', false)}
            {renderStat('Met', summary.metCount, 'var(--accentDeep)', false)}
            {renderStat('Short', summary.shortCount, hasShort ? 'var(--accentDeep)' : 'var(--muted)', hasShort)}
          </div>

          {/* Met-of-total summary line. Keep the "{metCount} of {totalFamilies}" phrasing intact. */}
          <p
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              fontSize: 14,
              color: 'var(--muted)',
              marginBottom: 20,
              lineHeight: 1.5,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 26,
                height: 26,
                flex: '0 0 auto',
                borderRadius: 999,
                background: allClear ? 'var(--accentSoft)' : 'var(--surface2)',
                color: allClear ? 'var(--accentDeep)' : 'var(--muted)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {allClear ? <SetuIcon.check width={14} height={14} /> : <SetuIcon.people width={14} height={14} />}
            </span>
            <span>
              <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>
                {summary.metCount} of {summary.totalFamilies}
              </strong>{' '}
              families have met the {hoursPerYear}-hour target.
            </span>
          </p>

          {/* Family rows — short-first order comes from the server. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map((row) => renderRow(row, hoursPerYear))}
          </div>
        </>
      ) : (
        <div
          className="card"
          style={{
            padding: 'clamp(32px, 8vw, 48px) 24px',
            textAlign: 'center',
            background: 'var(--surface)',
          }}
        >
          {/* Heart-in-rosette motif — shared with the roster + seva managers. */}
          <div
            aria-hidden
            style={{
              width: 72,
              height: 72,
              borderRadius: 999,
              background: 'var(--accentSoft)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 18,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                background: 'var(--surface)',
                color: 'var(--accent)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SetuIcon.calendar width={22} height={22} />
            </div>
          </div>
          <p style={{ fontSize: 18, color: 'var(--ink)', fontWeight: 600, letterSpacing: '-0.01em' }}>
            No seva year set yet
          </p>
          <p
            style={{
              fontSize: 14,
              color: 'var(--muted)',
              marginTop: 8,
              maxWidth: 340,
              marginInline: 'auto',
              lineHeight: 1.55,
            }}
          >
            Set an active seva year and hours target from the seva opportunities page to start tracking
            family compliance.
          </p>
        </div>
      )}
    </>
  );
}

// A single compliance card. The whole row is a link to the family detail page.
// Status drives the rail + avatar so Met (quietly affirmed) and Short (kindly
// flagged) read at a glance. Rendered as a function (never a nested component)
// to avoid remount churn.
function renderRow(row: ComplianceRow, hoursPerYear: number) {
  const pct = hoursPerYear > 0 ? Math.min(100, Math.round((row.hoursEarned / hoursPerYear) * 100)) : 0;
  const Glyph = row.met ? SetuIcon.check : SetuIcon.warn;
  return (
    <Link
      key={row.fid}
      href={`/welcome/family/${row.fid}`}
      className="card focus-ring"
      style={{
        display: 'block',
        padding: 0,
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        borderColor: row.met ? 'var(--accent)' : 'var(--line)',
      }}
    >
      {/* Affirming accent rail on families that met the target — the rewarding signal. */}
      {row.met && <div aria-hidden style={{ height: 3, background: 'var(--accent)' }} />}

      <div style={{ padding: 'clamp(15px, 4vw, 18px)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 auto' }}>
            <span
              aria-hidden
              style={{
                width: 36,
                height: 36,
                flex: '0 0 auto',
                borderRadius: 999,
                background: row.met ? 'var(--accentSoft)' : 'var(--surface2)',
                color: row.met ? 'var(--accentDeep)' : 'var(--muted)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Glyph width={16} height={16} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.25 }}>
                {row.name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>
                {row.hoursEarned} of {hoursPerYear} hrs
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
            {row.met ? (
              <span
                className="pill"
                style={{ fontWeight: 600, background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}
              >
                <SetuIcon.check width={13} height={13} /> Met
              </span>
            ) : (
              <span
                className="pill"
                style={{ fontWeight: 600, background: 'var(--surface2)', color: 'var(--muted)' }}
              >
                Short
              </span>
            )}
            <span aria-hidden style={{ display: 'inline-flex', color: 'var(--line2)' }}>
              <SetuIcon.chevron width={16} height={16} />
            </span>
          </div>
        </div>
        {/* Thin progress hint toward the target, with a quiet percentage tick. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 13 }}>
          <div
            aria-hidden
            style={{
              flex: '1 1 auto',
              height: 5,
              borderRadius: 999,
              background: 'var(--surface2)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                borderRadius: 999,
                background: row.met ? 'var(--accent)' : 'var(--accentDeep)',
                opacity: row.met ? 1 : 0.55,
              }}
            />
          </div>
          <span
            aria-hidden
            style={{
              flex: '0 0 auto',
              fontSize: 11,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: row.met ? 'var(--accentDeep)' : 'var(--muted)',
            }}
          >
            {pct}%
          </span>
        </div>
      </div>
    </Link>
  );
}

// A single cell in the stat strip. The `lead` flag washes the actionable column
// in soft accent (mirrors the roster band). Hoisted-style render helper (called
// as a function, not declared as a nested component).
function renderStat(label: string, value: number, valueColor: string, lead: boolean) {
  return (
    <div
      key={label}
      style={{
        padding: 'clamp(13px, 3.5vw, 18px) clamp(10px, 3vw, 16px)',
        textAlign: 'center',
        background: lead && value > 0 ? 'var(--accentSoft)' : 'transparent',
        borderRight: '1px solid var(--line)',
      }}
    >
      <div
        style={{
          fontSize: 'clamp(22px, 7vw, 28px)',
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color: valueColor,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          color: 'var(--muted)',
          marginTop: 7,
        }}
      >
        {label}
      </div>
    </div>
  );
}
