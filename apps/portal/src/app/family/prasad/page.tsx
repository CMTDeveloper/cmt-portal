import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getFamilyAssignment } from '@/features/setu/prasad/family-assignment';
import { FamilyPrasadCard } from '@/features/setu/prasad/family-prasad-card';
import { CspRoot } from '@/features/family/components/atoms';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Prasad seva' };

const HOW_IT_WORKS = [
  'Each family brings prasad for the assembly one Sunday per year. We suggest a date — your youngest child’s birthday month when possible.',
  'Confirm the suggested Sunday, or pick any other open Sunday that works better for your family.',
  'We send reminders by email and text a week before and again two days before your Sunday.',
  'Plans change? Move a confirmed date yourself any time up to a week before — no need to call.',
];

export default async function FamilyPrasadPage() {
  await connection();
  // Slice 1 (Part C): Prasad is hidden from families until re-enabled. When the
  // flag is off, bounce back to the dashboard rather than 500 on a data read.
  if (!flags.setuPrasad) redirect('/family');
  const data = await getCurrentFamily();
  if (!data) redirect('/sign-in?from=/family/prasad');

  const assignment = await getFamilyAssignment(data.family.fid);

  // Page body — shared between the mobile and desktop branches. The card is the
  // same component the dashboard uses, in its `expanded` full-width variant, with
  // the standing explainer below it (and a friendly empty state when nothing has
  // been published for this family yet).
  const body = (
    <div className="col" style={{ gap: 18, maxWidth: 640 }}>
      <div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--accent)',
            textTransform: 'uppercase',
            letterSpacing: '.1em',
            fontWeight: 600,
          }}
        >
          Prasad seva
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 4 }}>
          Bringing prasad
        </h1>
      </div>

      {assignment ? (
        <FamilyPrasadCard assignment={assignment} expanded />
      ) : (
        <div className="card" style={{ padding: 24 }}>
          <div
            aria-hidden
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'var(--accentSoft)',
              color: 'var(--accent)',
              display: 'grid',
              placeItems: 'center',
              marginBottom: 14,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M3 11h18a9 9 0 0 1-18 0Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M12 11V8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M9.5 8c0-1.4 1.1-2.5 2.5-2.5S14.5 6.6 14.5 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </div>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>No prasad Sunday yet</h2>
          <p style={{ fontSize: 13.5, color: 'var(--body-text)', lineHeight: 1.55, marginTop: 8 }}>
            Your family doesn&rsquo;t have a prasad Sunday yet — it&rsquo;ll appear here once the schedule is published.
          </p>
        </div>
      )}

      <div className="card" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 14 }}>
          How prasad seva works
        </h2>
        <ol className="col" style={{ gap: 12, listStyle: 'none', padding: 0, margin: 0 }}>
          {HOW_IT_WORKS.map((line, i) => (
            <li key={i} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <span
                aria-hidden
                style={{
                  flex: '0 0 auto',
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'var(--accentSoft)',
                  color: 'var(--accentDeep)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5 }}>{line}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );

  // The /family layout renders the mobile branch as a bare pass-through (no
  // CspRoot, no padding) while the desktop <main> is already CspRoot-wrapped and
  // padded. So the mobile branch needs its own CspRoot — both to resolve the
  // --setu-* tokens (only inside .csp) and to clear the fixed bottom nav (~64px).
  return (
    <>
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh', padding: '18px 18px 96px' }}>{body}</CspRoot>
      </div>
      <div className="hidden md:block">{body}</div>
    </>
  );
}
