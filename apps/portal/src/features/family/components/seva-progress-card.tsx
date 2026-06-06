import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import type { SevaCardView } from '@/features/setu/seva/get-family-seva-progress';

interface SevaProgressCardProps {
  view: SevaCardView;
  hoursEarned: number;
  hoursPerYear: number;
  currentSevaYear: string | null;
}

export function SevaProgressCard({ view, hoursEarned, hoursPerYear, currentSevaYear }: SevaProgressCardProps) {
  if (!view.show) return null;

  const { complete } = view;
  // Floor any nonzero progress so the smallest contribution still paints a sliver
  // of the rail — empty-looking bars read as "you've done nothing", which is the
  // opposite of the gently-encouraging tone we want for the short state.
  const fillPct = view.pct <= 0 ? 0 : Math.max(view.pct, 4);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="between" style={{ marginBottom: 14 }}>
        <span className="row" style={{ gap: 10 }}>
          {/* Heart rosette — the seva-browser goal-band motif, scaled to the
              dashboard card. On completion it becomes a filled accent check so
              the card itself reads as a small "thank you". */}
          <span
            aria-hidden
            style={{
              width: 30,
              height: 30,
              flex: '0 0 auto',
              borderRadius: 999,
              background: complete ? 'var(--accent)' : 'var(--accentSoft)',
              color: complete ? '#fff' : 'var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {complete ? <SetuIcon.check width={16} height={16} /> : <SetuIcon.heart width={16} height={16} />}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Seva hours</span>
        </span>
        {currentSevaYear && (
          <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>{currentSevaYear}</span>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <span
          style={{
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: complete ? 'var(--accentDeep)' : 'var(--ink)',
          }}
        >
          {`${hoursEarned} of ${hoursPerYear}`}
        </span>
        <span style={{ color: 'var(--muted)', marginLeft: 7, fontSize: 13 }}>hours</span>
      </div>

      {/* Warm progress rail — taller and accent-tinted so even partial progress
          feels like filling a goal rather than an empty meter. */}
      <div
        style={{
          height: 8,
          background: complete ? 'var(--accent)' : 'var(--accentSoft)',
          borderRadius: 99,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${fillPct}%`,
            height: '100%',
            background: 'var(--accent)',
            borderRadius: 99,
          }}
        />
      </div>

      {complete ? (
        <div className="row" style={{ gap: 6, fontSize: 11.5, color: 'var(--accentDeep)', marginTop: 9, fontWeight: 600 }}>
          <SetuIcon.check width={13} height={13} />
          Goal reached — thank you for your seva.
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 9 }}>
          {`${view.remaining} ${view.remaining === 1 ? 'hour' : 'hours'} to go — find an opportunity.`}
        </div>
      )}

      <Link
        href="/family/seva"
        className={`btn ${complete ? 'btn--s' : 'btn--p'} btn--block`}
        style={{ marginTop: 14, minHeight: 44, textDecoration: 'none' }}
      >
        {complete ? 'View seva' : 'Find seva'}
      </Link>
    </div>
  );
}
