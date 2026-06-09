import { Suspense } from 'react';
import { connection } from 'next/server';
import type { Metadata } from 'next';
import { RosterBrowser } from '@/features/setu/roster/roster-browser';

export const metadata: Metadata = {
  title: 'Roster · Setu',
};

export default function WelcomeRosterPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading roster…</div>}>
      <WelcomeRosterBody />
    </Suspense>
  );
}

// The screen fetches its data client-side (browse list, search, migration
// strip). `await connection()` keeps PPR from attempting to prerender any
// incidental dynamic access at build — without it the "Collecting page data"
// pass can try to run a live read. The server component is just the static
// shell + <RosterBrowser/> (which owns both the mobile and desktop branches).
async function WelcomeRosterBody() {
  await connection();
  return <RosterBrowser />;
}
