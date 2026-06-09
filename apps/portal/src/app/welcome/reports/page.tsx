import { Suspense } from 'react';
import { connection } from 'next/server';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isAdmin, type WithRole } from '@cmt/shared-domain';
import { ReportsHub } from '@/features/setu/reports/reports-hub';

export const metadata: Metadata = {
  title: 'Reports · Setu',
};

export default function WelcomeReportsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading reports…</div>}>
      <WelcomeReportsBody />
    </Suspense>
  );
}

// The hub fetches every card's data client-side and fails per-card. The server
// component only resolves `isAdmin` from the session cookie (so it knows whether
// to render the donations + legacy cards) and `await connection()` to keep PPR
// from attempting a live read during "Collecting page data". The welcome layout
// already gates the route for welcome-team + admin; this read is purely to decide
// the admin-only cards (defence in depth — the API re-checks isAdmin too).
async function WelcomeReportsBody() {
  await connection();
  const sessionCookie = (await cookies()).get('__session')?.value;
  let admin = false;
  if (sessionCookie) {
    const raw = await verifyPortalSessionCookie(sessionCookie).catch(() => null);
    if (raw) admin = isAdmin(raw as unknown as WithRole);
  }
  return <ReportsHub isAdmin={admin} />;
}
