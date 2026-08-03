import { Suspense } from 'react';
import { connection } from 'next/server';
import type { Metadata } from 'next';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';
import { listKnownSchoolYears, resolveViewYear } from '@/features/setu/rollover/view-year';
import { SchoolYearScopeBar } from '@/features/setu/rollover/components/school-year-scope-bar';
import { ReportsHub } from '@/features/setu/reports/reports-hub';
import { denyUnlessAdmin } from '@/lib/require-admin-page';

export const metadata: Metadata = {
  title: 'Reports · Chinmaya Setu',
};

export default function WelcomeReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading reports…</div>}>
      <WelcomeReportsBody searchParams={searchParams} />
    </Suspense>
  );
}

// The hub fetches every card's data client-side and fails per-card. This server
// component only resolves the school-year scope and `await connection()`s to keep
// PPR from attempting a live read during "Collecting page data". The welcome
// layout admits welcome-team + coordinator (they own the roster inside it), so
// this page carries its own admin gate.
async function WelcomeReportsBody({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await connection();
  const denied = await denyUnlessAdmin();
  if (denied) return denied;
  // Year scope (server-side, mirrors the merged Tasks 4–6 pattern): no/garbage
  // ?year= falls back to live ⇒ undefined ⇒ unscoped (no regression); a
  // Past/Preparing year scopes the cards to that year.
  const db = portalFirestore();
  const liveYear = await getLiveSchoolYearCached();
  const years = await listKnownSchoolYears(db, liveYear);
  const view = resolveViewYear(years, liveYear, (await searchParams).year ?? null);
  return (
    <>
      {/* The scope bar used to be welcome-section chrome. It lives here now,
          on a page that actually reads ?year=. This route is admin-only, so
          canManage is unconditional. Mobile gets its own padding because the
          welcome layout's mobile branch supplies none. */}
      <div className="px-[18px] pt-[16px] md:px-0 md:pt-0">
        <SchoolYearScopeBar years={years} liveYear={liveYear} canManage />
      </div>
      <ReportsHub {...(view.status !== 'live' ? { year: view.year } : {})} />
    </>
  );
}
