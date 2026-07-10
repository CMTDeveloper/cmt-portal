import { Suspense } from 'react';
import { connection } from 'next/server';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isAdmin, type WithRole } from '@cmt/shared-domain';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';
import { listKnownSchoolYears, resolveViewYear } from '@/features/setu/rollover/view-year';
import { ReportsHub } from '@/features/setu/reports/reports-hub';

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

// The hub fetches every card's data client-side and fails per-card. The server
// component only resolves `isAdmin` from the session cookie (so it knows whether
// to render the donations + legacy cards) and `await connection()` to keep PPR
// from attempting a live read during "Collecting page data". The welcome layout
// already gates the route for welcome-team + admin; this read is purely to decide
// the admin-only cards (defence in depth — the API re-checks isAdmin too).
async function WelcomeReportsBody({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await connection();
  const sessionCookie = (await cookies()).get('__session')?.value;
  let admin = false;
  if (sessionCookie) {
    const raw = await verifyPortalSessionCookie(sessionCookie).catch(() => null);
    if (raw) admin = isAdmin(raw as unknown as WithRole);
  }
  // Year scope (server-side, mirrors the merged Tasks 4–6 pattern): no/garbage
  // ?year= falls back to live ⇒ undefined ⇒ unscoped (no regression); a
  // Past/Preparing year scopes the cards to that year.
  const db = portalFirestore();
  const liveYear = await getLiveSchoolYearCached();
  const years = await listKnownSchoolYears(db, liveYear);
  const view = resolveViewYear(years, liveYear, (await searchParams).year ?? null);
  return <ReportsHub isAdmin={admin} {...(view.status !== 'live' ? { year: view.year } : {})} />;
}
