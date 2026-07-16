import React from 'react';

// Instant skeleton for the attendance screen. Next renders this in the page slot
// (inside the persistent teacher layout + sidebar) the moment a teacher taps a
// class, while the server derives the roster. It mirrors the real
// AttendanceMarker layout (same 540px column, date card, 3-up stats, list rows)
// so there is no layout jump when the students stream in. The back link + date
// chrome read as "real" immediately; only the roster-derived bits shimmer.

const CONTENT_MAX = 540;

// A single shimmer block. `.cmt-sk` is defined in the <style> below.
function Sk({ w = '100%', h, r = 8, style }: { w?: number | string; h: number; r?: number; style?: React.CSSProperties }) {
  return <span aria-hidden className="cmt-sk" style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }} />;
}

function RowSk({ nameW }: { nameW: number }) {
  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
        boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
      }}
    >
      <Sk w={40} h={40} r={20} />
      <Sk w={nameW} h={14} style={{ flex: '0 0 auto' }} />
      <span style={{ flex: 1 }} />
      <Sk w={22} h={22} r={11} />
    </div>
  );
}

function StatCellSk({ last = false }: { last?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: '13px 6px 14px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        borderRight: last ? 'none' : '1px solid var(--line)',
      }}
    >
      <Sk w={46} h={8} r={4} />
      <Sk w={26} h={20} r={5} />
    </div>
  );
}

export default function TakeAttendanceLoading() {
  return (
    <div role="status" aria-label="Loading class" style={{ maxWidth: CONTENT_MAX, margin: '0 auto', paddingBottom: 48 }}>
      <style>{`
        @keyframes cmt-sk { 0% { background-position: -280px 0 } 100% { background-position: calc(280px + 100%) 0 } }
        .cmt-sk {
          background: linear-gradient(90deg, var(--surface2, #eef1f3) 25%, var(--line, #e2e6e9) 37%, var(--surface2, #eef1f3) 63%);
          background-size: 560px 100%;
          animation: cmt-sk 1.4s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) { .cmt-sk { animation: none } }
      `}</style>

      {/* Header — the back link is real (instant); title + subtitle shimmer. */}
      <header>
        <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>← My classes</span>
        <Sk w={168} h={26} r={7} style={{ margin: '12px 0 0' }} />
        <Sk w={92} h={12} r={6} style={{ margin: '9px 0 0' }} />

        {/* Date card */}
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            padding: 8,
            boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minHeight: 44 }}>
            <Sk w={38} h={38} r={9} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <Sk w={118} h={14} r={7} />
              <Sk w={74} h={10} r={5} />
            </div>
            <Sk w={38} h={38} r={9} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Sk h={44} r={10} />
            <Sk h={44} r={10} />
          </div>
        </div>
      </header>

      {/* 3-up summary */}
      <div
        style={{
          marginTop: 14,
          display: 'flex',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
          boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
        }}
      >
        <StatCellSk />
        <StatCellSk />
        <StatCellSk last />
      </div>

      {/* Search */}
      <Sk h={46} r={12} style={{ marginTop: 14 }} />

      {/* Filter row */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <Sk w={168} h={34} r={10} />
        <Sk w={110} h={14} r={7} />
      </div>

      {/* Section heading */}
      <Sk w={150} h={12} r={6} style={{ margin: '18px 0 12px' }} />

      {/* Roster rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {[152, 190, 128, 168, 144, 176].map((w, i) => (
          <RowSk key={i} nameW={w} />
        ))}
      </div>
    </div>
  );
}
