import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isWelcomeTeam, isAdmin, isTeacher, type WithRole } from '@cmt/shared-domain';
import { flags } from '@/lib/flags';
import { CspRoot } from '@/features/family/components/atoms';
import { DesktopSidebarLive } from '@/features/family/components/desktop-sidebar';
import { WelcomeMobileNav } from '@/features/family/components/welcome-mobile-nav';
import { LoadingOm } from '@/components/chrome/loading-om';

// The layout is synchronous so cacheComponents:true can stream the shell.
// The role check is async (cookies + session verify) so it lives inside its
// own <Suspense> boundary, and so does the children's main area. Both render
// the chrome immediately.

async function WelcomeChromeAndChildren({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  // isWelcomeTeam() checks role OR extraRoles AND treats admin as inheriting
  // welcome-team capability — so admins and family-managers-with-welcome-team
  // both pass here without needing strict role equality.
  let allowed = false;
  let showTeacher = false;
  if (sessionCookie) {
    const raw = await verifyPortalSessionCookie(sessionCookie);
    if (raw && isWelcomeTeam(raw as unknown as WithRole)) {
      allowed = true;
      showTeacher = flags.setuTeacher && isTeacher(raw as unknown as WithRole);
    }
  }

  return (
    <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
      {allowed ? (
        <DesktopSidebarLive role="welcome-team" displayName="Welcome team" subtitle="Welcome team" showSignOut showTeacher={showTeacher}/>
      ) : (
        <div style={{ width: 248, background: 'var(--surface)', borderRight: '1px solid var(--line)' }}/>
      )}
      <main style={{ flex: 1, padding: '32px 40px', overflow: 'auto' }}>
        {allowed ? (
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

// Mobile bottom nav for the welcome section. Confirms welcome-team access and
// passes isAdmin/hasFamily so the nav shows the right "back" tab.
async function WelcomeMobileNavWithIdentity() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  if (!sessionCookie) return null;
  const raw = await verifyPortalSessionCookie(sessionCookie).catch(() => null);
  if (!raw || !isWelcomeTeam(raw as unknown as WithRole)) return null;
  const admin = isAdmin(raw as unknown as WithRole);
  const hasFamily = typeof (raw as { fid?: unknown }).fid === 'string';
  const showTeacher = flags.setuTeacher && isTeacher(raw as unknown as WithRole);
  return <WelcomeMobileNav isAdmin={admin} hasFamily={hasFamily} showTeacher={showTeacher} />;
}

export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Mobile: pass-through. Each page renders its own mobile chrome.
          Wrapped in <Suspense> so dynamic children stream under cacheComponents. */}
      <div className="block md:hidden">
        {/* CspRoot so brand tokens resolve for welcome pages that don't wrap
            themselves (e.g. /welcome/levels). Pages that self-wrap just nest
            harmlessly. No padding here — pages own their own. */}
        <CspRoot style={{ minHeight: '100dvh' }}>
          <Suspense fallback={<LoadingOm />}>
            {children}
          </Suspense>
        </CspRoot>
        <Suspense fallback={null}>
          <WelcomeMobileNavWithIdentity />
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
