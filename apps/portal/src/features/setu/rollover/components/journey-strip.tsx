import type { JourneyRow } from '../get-child-journey';

interface JourneyStripProps {
  rows: JourneyRow[];
}

function rowLabel(row: JourneyRow): string {
  const grade = row.schoolGrade ? `Grade ${row.schoolGrade}` : '—';
  return row.levelName ? `${grade} · ${row.levelName}` : grade;
}

/**
 * A compact, themed year-by-year strip of a child's Bala Vihar journey — newest
 * first. Filled dot + accent "Active" badge for the current year; hollow dot +
 * muted "Completed" for closed years. Purely presentational; stacks on mobile.
 */
export function JourneyStrip({ rows }: JourneyStripProps) {
  return (
    <div data-testid="bv-journey" style={{ marginTop: 18 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: '.12em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: 'var(--muted)',
          marginBottom: 10,
        }}
      >
        Bala Vihar journey
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            padding: '11px 13px',
            borderRadius: 'var(--radiusSm)',
            background: 'var(--surface2)',
            fontSize: 13,
            color: 'var(--muted)',
            lineHeight: 1.5,
          }}
        >
          No Bala Vihar history yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row, i) => (
            <div
              key={`${row.termLabel}-${i}`}
              data-testid="bv-journey-row"
              className="card"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                borderColor: row.active ? 'var(--accent)' : 'var(--line)',
              }}
            >
              <span
                aria-hidden
                style={{
                  flex: '0 0 auto',
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: row.active ? 'var(--accent)' : 'transparent',
                  border: row.active ? '1px solid var(--accent)' : '1.5px solid var(--line2)',
                }}
              />
              <div style={{ minWidth: 0, flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 10px' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--mono)' }}>
                  {row.termLabel}
                </span>
                <span style={{ fontSize: 13, color: 'var(--body-text)' }}>{rowLabel(row)}</span>
              </div>
              <span
                className="pill"
                style={{
                  flex: '0 0 auto',
                  fontWeight: 600,
                  background: row.active ? 'var(--accentSoft)' : 'var(--surface2)',
                  color: row.active ? 'var(--accentDeep)' : 'var(--muted)',
                }}
              >
                {row.active ? 'Active' : 'Completed'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
