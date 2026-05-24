import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { SetuSessionClaimsSchema } from '@cmt/shared-domain/setu';
import { CspRoot } from '@/features/family/components/atoms';
import { DesktopSidebarLive } from '@/features/family/components/desktop-sidebar';
import { LoadingOm } from '@/components/chrome/loading-om';

// The layout is synchronous so cacheComponents:true can stream the shell.
// The role check is async (cookies + session verify) so it lives inside its
// own <Suspense> boundary, and so does the children's main area. Both render
// the chrome immediately.

async function WelcomeChromeAndChildren({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  let isWelcomeTeam = false;
  if (sessionCookie) {
    const raw = await verifyPortalSessionCookie(sessionCookie);
    if (raw) {
      const parsed = SetuSessionClaimsSchema.safeParse(raw);
      if (parsed.success && parsed.data.role === 'welcome-team') {
        isWelcomeTeam = true;
      }
    }
  }

  return (
    <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
      {isWelcomeTeam ? (
        <DesktopSidebarLive role="welcome-team" displayName="Welcome team" subtitle="Welcome team" showSignOut/>
      ) : (
        <div style={{ width: 248, background: 'var(--surface)', borderRight: '1px solid var(--line)' }}/>
      )}
      <main style={{ flex: 1, padding: '32px 40px', overflow: 'auto' }}>
        {isWelcomeTeam ? (
          children
        ) : (
          <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
            <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Welcome-team role required.</p>
          </div>
        )}
      </main>
    </CspRoot>
  );
}

export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Mobile: pass-through. Each page renders its own mobile chrome.
          Wrapped in <Suspense> so dynamic children stream under cacheComponents. */}
      <div className="block md:hidden">
        <Suspense fallback={<LoadingOm />}>
          {children}
        </Suspense>
      </div>

      {/* Desktop: chrome streams via Suspense so the static shell renders first. */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <Suspense fallback={<div style={{ minHeight: '100dvh', width: '100%' }}/>}>
          <WelcomeChromeAndChildren>{children}</WelcomeChromeAndChildren>
        </Suspense>
      </div>
    </>
  );
}
