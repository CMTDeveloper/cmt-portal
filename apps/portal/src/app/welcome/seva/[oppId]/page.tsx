import { Suspense } from 'react';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { SetuIcon } from '@cmt/ui';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isWelcomeTeam, type WithRole } from '@cmt/shared-domain';
import { CspRoot } from '@/features/family/components/atoms';
import { getOpportunityRoster } from '@/features/setu/seva/get-opportunity-roster';
import { RosterManager } from '@/features/admin/seva/roster-manager';
import type { RosterData } from '@/features/admin/seva/roster-client';

export const metadata = { title: 'Seva roster — CMT Portal' };

export default function WelcomeSevaRosterPage({ params }: { params: Promise<{ oppId: string }> }) {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading roster…</div>}>
      <RosterPageBody params={params} />
    </Suspense>
  );
}

// Exported for testing — the default export is a thin Suspense wrapper (Next.js
// 16 Cache Components require dynamic data access inside <Suspense>).
export async function RosterPageBody({ params }: { params: Promise<{ oppId: string }> }) {
  await connection();
  const cookieStore = await cookies();
  const raw = await verifyPortalSessionCookie(cookieStore.get('__session')?.value ?? '').catch(() => null);
  if (!raw || !isWelcomeTeam(raw as unknown as WithRole)) {
    return (
      <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Welcome-team role required.</p>
      </div>
    );
  }

  const { oppId } = await params;
  const roster = await getOpportunityRoster(oppId);
  if (!roster) notFound();

  // getOpportunityRoster already filters out `cancelled` signups, but its row
  // type still carries the full status union. Narrow to the confirmable shape
  // the client RosterManager expects (no `cancelled`).
  const initial: RosterData = {
    opportunity: roster.opportunity,
    rows: roster.rows.flatMap((r) =>
      r.status === 'cancelled' ? [] : [{ ...r, status: r.status }],
    ),
  };

  const manager = <RosterManager initial={initial} />;
  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link
                href="/welcome/seva"
                className="focus-ring"
                style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}
              >
                <SetuIcon.back />
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Seva roster</span>
              <div style={{ width: 32 }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 96px' }}>{manager}</div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns the sidebar + padded <main>. */}
      <div className="hidden md:block" style={{ maxWidth: 760 }}>
        <Link
          href="/welcome/seva"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 16 }}
        >
          <SetuIcon.back /> Back to opportunities
        </Link>
        {manager}
      </div>
    </>
  );
}
