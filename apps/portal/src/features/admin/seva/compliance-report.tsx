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
              alignItems: 'center',
              gap: 10,
              marginTop: 12,
              fontSize: 13.5,
              color: 'var(--body-text)',
            }}
          >
            <span style={{ fontWeight: 600 }}>{currentSevaYear}</span>
            <span aria-hidden style={{ color: 'var(--line2)' }}>·</span>
            <span>{hoursPerYear} hrs / family / year</span>
          </div>
        ) : null}
      </header>

      {hasYear ? (
        <>
          {/* Stat strip — Total / Met / Short at a glance. */}
          <div
            className="card"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              marginBottom: 22,
              overflow: 'hidden',
            }}
          >
            {renderStat('Total', summary.totalFamilies, 'var(--ink)')}
            {renderStat('Met', summary.metCount, 'var(--accentDeep)')}
            {renderStat('Short', summary.shortCount, 'var(--muted)')}
          </div>

          {/* Met-of-total summary line. */}
          <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 18, lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>
              {summary.metCount} of {summary.totalFamilies}
            </strong>{' '}
            families have met the {hoursPerYear}-hour target.
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
            padding: 'clamp(28px, 7vw, 44px) 24px',
            textAlign: 'center',
            background: 'var(--surface)',
          }}
        >
          <div
            aria-hidden
            style={{
              width: 52,
              height: 52,
              borderRadius: 999,
              background: 'var(--accentSoft)',
              color: 'var(--accentDeep)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <SetuIcon.calendar />
          </div>
          <p style={{ fontSize: 17, color: 'var(--ink)', fontWeight: 600 }}>No seva year set yet</p>
          <p
            style={{
              fontSize: 14,
              color: 'var(--muted)',
              marginTop: 8,
              maxWidth: 340,
              marginInline: 'auto',
              lineHeight: 1.5,
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
// Rendered as a function (never a nested component) to avoid remount churn.
function renderRow(row: ComplianceRow, hoursPerYear: number) {
  const pct = hoursPerYear > 0 ? Math.min(100, Math.round((row.hoursEarned / hoursPerYear) * 100)) : 0;
  return (
    <Link
      key={row.fid}
      href={`/welcome/family/${row.fid}`}
      className="card focus-ring"
      style={{
        display: 'block',
        padding: 'clamp(14px, 4vw, 18px)',
        textDecoration: 'none',
        color: 'inherit',
        borderColor: row.met ? 'var(--accent)' : 'var(--line)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.25 }}>
            {row.name}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            {row.hoursEarned} of {hoursPerYear} hrs
          </div>
        </div>
        {row.met ? (
          <span
            className="pill"
            style={{ flex: '0 0 auto', fontWeight: 600, background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}
          >
            Met
          </span>
        ) : (
          <span
            className="pill"
            style={{ flex: '0 0 auto', fontWeight: 600, background: 'var(--surface2)', color: 'var(--muted)' }}
          >
            Short
          </span>
        )}
      </div>
      {/* Thin progress bar toward the target. */}
      <div
        aria-hidden
        style={{
          marginTop: 12,
          height: 4,
          borderRadius: 999,
          background: 'var(--surface2)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: row.met ? 'var(--accent)' : 'var(--accentSoft)',
          }}
        />
      </div>
    </Link>
  );
}

// A single cell in the stat strip. Hoisted-style render helper (called as a
// function, not declared as a nested component).
function renderStat(label: string, value: number, valueColor: string) {
  return (
    <div
      key={label}
      style={{
        padding: 'clamp(13px, 3.5vw, 18px) clamp(10px, 3vw, 16px)',
        textAlign: 'center',
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
