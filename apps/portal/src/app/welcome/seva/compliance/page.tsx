import { Suspense } from 'react';
import { connection } from 'next/server';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { SetuIcon } from '@cmt/ui';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isWelcomeTeam, type WithRole } from '@cmt/shared-domain';
import { CspRoot } from '@/features/family/components/atoms';
import { getSevaCompliance } from '@/features/setu/seva/get-seva-compliance';
import { ComplianceReport } from '@/features/admin/seva/compliance-report';

export const metadata = { title: 'Seva compliance — CMT Portal' };

export default function WelcomeSevaCompliancePage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading compliance…</div>}>
      <CompliancePageBody />
    </Suspense>
  );
}

// Exported for testing — the default export is a thin Suspense wrapper (Next.js
// 16 Cache Components require dynamic data access inside <Suspense>).
export async function CompliancePageBody() {
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

  const data = await getSevaCompliance();
  const report = <ComplianceReport initial={data} />;

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
              <span style={{ fontSize: 14, fontWeight: 600 }}>Seva compliance</span>
              <div style={{ width: 32 }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 96px' }}>{report}</div>
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
        {report}
      </div>
    </>
  );
}
