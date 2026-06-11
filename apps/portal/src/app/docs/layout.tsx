import { Suspense } from 'react';
import Link from 'next/link';
import { SetuLogo } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { LoadingOm } from '@/components/chrome/loading-om';
import { getDocsViewer } from '@/features/docs/viewer';
import './docs.css';

// The docs hub owns its chrome (added to chrome-wrapper SUPPRESS_PATTERNS):
// a slim sticky bar over a centered reading column. "Back to portal" goes to
// '/' — the auth-entry redirect lands every signed-in role on its own
// dashboard, so one href serves admin, welcome-team, and parent-teachers.
async function DocsGate({ children }: { children: React.ReactNode }) {
  const viewer = await getDocsViewer();

  return (
    <CspRoot style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 20px',
          paddingTop: 'max(10px, env(safe-area-inset-top))',
          background: 'color-mix(in srgb, var(--surface) 86%, transparent)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <Link href="/docs" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <SetuLogo size={26} />
          <span style={{ fontWeight: 650, fontSize: 15, color: 'var(--ink)' }}>Guides</span>
        </Link>
        <span
          className="docs-topbar-pill"
          style={{ fontSize: 11, color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}
        >
          team documentation
        </span>
        <div style={{ flex: 1 }} />
        <Link
          href="/"
          style={{ fontSize: 13, color: 'var(--accentDeep)', textDecoration: 'none', fontWeight: 550, whiteSpace: 'nowrap' }}
        >
          Back to portal →
        </Link>
      </header>
      <main style={{ flex: 1, maxWidth: 880, width: '100%', margin: '0 auto', padding: '28px 20px 64px' }}>
        {viewer ? (
          children
        ) : (
          <p style={{ color: 'var(--err)', fontSize: 14, padding: 32 }}>
            Access denied. The guides are available to the welcome team, teachers, and admins.
          </p>
        )}
      </main>
    </CspRoot>
  );
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<LoadingOm />}>
      <DocsGate>{children}</DocsGate>
    </Suspense>
  );
}
