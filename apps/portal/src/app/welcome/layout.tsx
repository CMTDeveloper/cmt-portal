import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isWelcomeTeam, isAdmin, isTeacher, hasRole, type WithRole } from '@cmt/shared-domain';
import { flags } from '@/lib/flags';
import { CspRoot } from '@/features/family/components/atoms';
import { DesktopSidebarLive } from '@/features/family/components/desktop-sidebar';
import { AdminSidebarLive } from '@/features/admin/components/admin-sidebar';
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
  let admin = false;
  // Purely a LABELLING question now: a coordinator sees the same nav as a
  // welcome-team volunteer (same grant since 2026-08-05) but is shown their own
  // job title, and coordinator is the senior one if somebody holds both.
  //
  // It must be asked with hasRole. The old form was
  // `!isWelcomeTeam(x) && isCoordinator(x)`, which is now permanently FALSE -
  // isWelcomeTeam returns true for coordinator - so the "Coordinator" label
  // would have silently vanished for everyone holding the role. A derived
  // boolean that can no longer be true is the quiet way a UI loses a state.
  let showCoordinatorLabel = false;
  let hasFamily = false;
  let email: string | undefined;
  if (sessionCookie) {
    const raw = await verifyPortalSessionCookie(sessionCookie);
    // isCoordinator is subsumed by isWelcomeTeam and no longer named here.
    if (raw && isWelcomeTeam(raw as unknown as WithRole)) {
      allowed = true;
      showCoordinatorLabel =
        hasRole(raw as unknown as WithRole, 'coordinator') &&
        !isAdmin(raw as unknown as WithRole);
      showTeacher = flags.setuTeacher && isTeacher(raw as unknown as WithRole);
      // Admins inherit welcome-team and reach /welcome (search, seva) via the
      // admin nav — keep them in the ADMIN sidebar so the menu doesn't swap out.
      admin = isAdmin(raw as unknown as WithRole);
      hasFamily = typeof (raw as { fid?: unknown }).fid === 'string';
      email = (raw as { email?: string }).email;
    }
  }

  return (
    <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
      {allowed ? (
        admin ? (
          <AdminSidebarLive displayEmail={email ?? 'Admin'} hasFamily={hasFamily} showTeacher={showTeacher} canSeeAdminOnly />
        ) : (
          <DesktopSidebarLive
            role={showCoordinatorLabel ? 'coordinator' : 'welcome-team'}
            displayName={showCoordinatorLabel ? 'Coordinator' : 'Welcome team'}
            subtitle={showCoordinatorLabel ? 'Coordinator' : 'Welcome team'}
            showSignOut
            showTeacher={showTeacher}
            hasFamily={hasFamily}
          />
        )
      ) : (
        <div style={{ width: 248, background: 'var(--surface)', borderRight: '1px solid var(--line)' }}/>
      )}
      <main style={{ flex: 1, padding: '32px 40px', overflow: 'auto' }}>
        {allowed ? (
          children
        ) : (
          <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
            <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Welcome-team or coordinator role required.</p>
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
  // No coordinator/welcome-team distinction on the phone: this bar shows icons
  // and destinations, no job title, and both roles now reach the same ones.
  // The desktop sidebar is where the label differs.
  const hasFamily = typeof (raw as { fid?: unknown }).fid === 'string';
  const showTeacher = flags.setuTeacher && isTeacher(raw as unknown as WithRole);
  return (
    <WelcomeMobileNav
      isAdmin={admin}
      hasFamily={hasFamily}
      showTeacher={showTeacher}
    />
  );
}

// The school-year scope bar used to live here, pinned above EVERY welcome page
// on both phone and desktop. It is a page-level scope control, not chrome: only
// /welcome/reports and /welcome/seva read `?year=`, and on a phone the banner
// was consuming the top third of the roster — the screen the front desk opens
// all day and which is always the live year. Those two pages render it
// themselves now, which also drops two Firestore reads from every other welcome
// page load. Trade-off worth stating: the roster keeps honouring an explicit
// `?year=` in the URL, but has no control to set one.

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
