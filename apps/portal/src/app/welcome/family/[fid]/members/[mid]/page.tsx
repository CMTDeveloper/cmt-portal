import { Suspense } from 'react';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { SetuIcon } from '@cmt/ui';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isWelcomeTeam, isAdmin, type WithRole } from '@cmt/shared-domain';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { CspRoot } from '@/features/family/components/atoms';
import { getChildProfile } from '@/features/setu/members/get-child-profile';
import { ChildProfileView } from '@/features/setu/members/child-profile-view';
import { getChildBalaViharJourney } from '@/features/setu/rollover/get-child-journey';
import { MemberGradeEditor } from '@/features/setu/rollover/member-grade-editor';

export const metadata = { title: 'Profile — CMT Portal' };

export default function WelcomeMemberProfilePage({
  params,
}: {
  params: Promise<{ fid: string; mid: string }>;
}) {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading profile…</div>}>
      <WelcomeMemberProfileBody params={params} />
    </Suspense>
  );
}

// Exported for testing — the default export is a thin Suspense wrapper (Next.js
// 16 Cache Components require dynamic data access inside <Suspense>).
export async function WelcomeMemberProfileBody({
  params,
}: {
  params: Promise<{ fid: string; mid: string }>;
}) {
  await connection();
  const cookieStore = await cookies();
  const raw = await verifyPortalSessionCookie(cookieStore.get('__session')?.value ?? '').catch(() => null);
  // Admins inherit welcome-team (so they reach this page) but ALSO get the
  // inline grade editor — welcome-team-only volunteers keep the page read-only.
  const admin = !!raw && isAdmin(raw as unknown as WithRole);
  if (!raw || !isWelcomeTeam(raw as unknown as WithRole)) {
    return (
      <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Welcome-team role required.</p>
      </div>
    );
  }

  const { fid, mid } = await params;
  const profile = await getChildProfile(mid);
  // mid must belong to the route's fid — guards against URL tampering.
  if (!profile || profile.fid !== fid) notFound();

  // Year-by-year Bala Vihar grade + level history (children only).
  const journey =
    profile.type === 'Child'
      ? await getChildBalaViharJourney(portalFirestore(), {
          fid: profile.fid,
          mid: profile.mid,
          member: { schoolGrade: profile.schoolGrade, birthMonthYear: profile.birthMonthYear },
        })
      : [];

  // Welcome reads the profile READ-ONLY — no editHref (exactOptionalPropertyTypes
  // means we omit the prop entirely rather than pass undefined). Admins get one
  // exception: an inline grade editor below the read-only view (children only —
  // grade is a child concept), so the rollover "Review →" link is actionable.
  const view = (
    <>
      <ChildProfileView profile={profile} journey={journey} />
      {admin && profile.type === 'Child' && (
        <MemberGradeEditor
          fid={profile.fid}
          mid={profile.mid}
          childName={profile.firstName}
          currentGrade={profile.schoolGrade}
        />
      )}
    </>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link
                href={`/welcome/family/${fid}`}
                className="focus-ring"
                style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}
              >
                <SetuIcon.back />
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Profile</span>
              <div style={{ width: 32 }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 96px' }}>{view}</div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns the sidebar + padded <main>. */}
      <div className="hidden md:block" style={{ maxWidth: 760 }}>
        <Link
          href={`/welcome/family/${fid}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 16 }}
        >
          <SetuIcon.back /> Back to family
        </Link>
        {view}
      </div>
    </>
  );
}
