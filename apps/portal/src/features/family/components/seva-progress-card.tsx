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

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="between" style={{ marginBottom: 10 }}>
        <span className="row" style={{ gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
          <SetuIcon.heart color="var(--accent)" />
          Seva hours
        </span>
        {currentSevaYear && (
          <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>{currentSevaYear}</span>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>{`${hoursEarned} of ${hoursPerYear}`}</span>
        <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 13 }}>hours</span>
      </div>

      <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${view.pct}%`, height: '100%', background: 'var(--accent)' }} />
      </div>

      {view.complete ? (
        <div style={{ fontSize: 11, color: 'var(--accentDeep)', marginTop: 8, fontWeight: 500 }}>
          Goal reached — thank you for your seva.
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
          {`${view.remaining} ${view.remaining === 1 ? 'hour' : 'hours'} to go — find an opportunity.`}
        </div>
      )}

      <Link
        href="/family/seva"
        className="btn btn--s"
        style={{ marginTop: 12, display: 'block', textAlign: 'center', textDecoration: 'none' }}
      >
        Find seva
      </Link>
    </div>
  );
}
