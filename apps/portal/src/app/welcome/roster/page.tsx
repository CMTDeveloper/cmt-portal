import { Suspense } from 'react';
import { connection } from 'next/server';
import type { Metadata } from 'next';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';
import { listKnownSchoolYears, resolveViewYear } from '@/features/setu/rollover/view-year';
import { getLocationOptions } from '@/lib/locations';
import { RosterBrowser } from '@/features/setu/roster/roster-browser';

export const metadata: Metadata = {
  title: 'Roster · Chinmaya Setu',
};

export default function WelcomeRosterPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading roster…</div>}>
      <WelcomeRosterBody searchParams={searchParams} />
    </Suspense>
  );
}

// The screen fetches its data client-side (browse list, search, migration
// strip). `await connection()` keeps PPR from attempting to prerender any
// incidental dynamic access at build — without it the "Collecting page data"
// pass can try to run a live read. The server component is just the static
// shell + <RosterBrowser/> (which owns both the mobile and desktop branches).
async function WelcomeRosterBody({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await connection();
  // Year scope (server-side, mirrors the reports page): no/garbage ?year= falls
  // back to live ⇒ undefined ⇒ unscoped (every family, no regression); a
  // Past/Preparing year scopes the browse list to that year's enrollees.
  const db = portalFirestore();
  const liveYear = await getLiveSchoolYearCached();
  const years = await listKnownSchoolYears(db, liveYear);
  const view = resolveViewYear(years, liveYear, (await searchParams).year ?? null);
  const locationOptions = await getLocationOptions();
  return <RosterBrowser locationOptions={locationOptions} {...(view.status !== 'live' ? { year: view.year } : {})} />;
}
