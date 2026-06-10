import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { CspRoot } from '@/features/family/components/atoms';
import { DesktopSidebar, DesktopSidebarLive } from '@/features/family/components/desktop-sidebar';
import { MobileBottomNav } from '@/features/family/components/mobile-bottom-nav';
import { LoadingOm } from '@/components/chrome/loading-om';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isAdmin, isTeacher, type WithRole } from '@cmt/shared-domain';
import { flags } from '@/lib/flags';

// The layout itself stays synchronous so cacheComponents:true can stream the
// static shell. The two awaited data fetches (sidebar identity, page body) are
// each wrapped in their own <Suspense> boundary so the rest of the chrome
// renders immediately.

async function SidebarWithIdentity() {
  const [data, sevak] = await Promise.all([getCurrentFamily(), readSevakFlagsFromCookie()]);
  let displayName: string | undefined;
  let subtitle: string | undefined;
  if (data) {
    const currentMember = data.members.find((m) => m.mid === data.currentMid);
    if (currentMember) displayName = `${currentMember.firstName} ${currentMember.lastName}`;
    subtitle = `${data.family.name}${data.family.legacyFid ? ` · FID ${data.family.fid} · Legacy ${data.family.legacyFid}` : ` · FID ${data.family.fid}`}`;
  }
  return <DesktopSidebarLive displayName={displayName} subtitle={subtitle} showSignOut isAdmin={sevak.isAdmin} showTeacher={sevak.showTeacher}/>;
}

// Mobile bottom nav needs isAdmin/showTeacher to decide whether the "More" sheet
// shows the Admin / Teacher shortcuts. Computed the same way as the desktop sidebar.
async function MobileNavWithIdentity() {
  const sevak = await readSevakFlagsFromCookie();
  return <MobileBottomNav isAdmin={sevak.isAdmin} showTeacher={sevak.showTeacher} />;
}

// Reads the session cookie once and runs isAdmin()/isTeacher() so the chrome can
// decide whether to show the Admin / Teacher shortcuts. Returns false on any
// error (missing cookie, expired session, etc.) — silent failure is fine here
// because middleware already gates access to /admin and /teacher themselves.
// Teacher is additionally gated on the flags.setuTeacher feature flag.
async function readSevakFlagsFromCookie(): Promise<{ isAdmin: boolean; showTeacher: boolean }> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) return { isAdmin: false, showTeacher: false };
    const claims = await verifyPortalSessionCookie(sessionCookie).catch(() => null);
    if (!claims) return { isAdmin: false, showTeacher: false };
    const withRole = claims as unknown as WithRole;
    return {
      isAdmin: isAdmin(withRole),
      showTeacher: flags.setuTeacher && isTeacher(withRole),
    };
  } catch {
    return { isAdmin: false, showTeacher: false };
  }
}

export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Mobile: pass-through. Each page renders its own mobile chrome.
          Wrapped in <Suspense> so dynamic children stream under cacheComponents. */}
      <div className="block md:hidden">
        <Suspense fallback={<LoadingOm />}>
          {children}
        </Suspense>
        <Suspense fallback={null}>
          <MobileNavWithIdentity />
        </Suspense>
      </div>

      {/* Desktop: shared sidebar around the children main area. */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <Suspense fallback={<DesktopSidebar showSignOut/>}>
            <SidebarWithIdentity />
          </Suspense>
          <main style={{ flex: 1, padding: '32px 48px', overflow: 'auto' }}>
            <Suspense fallback={<LoadingOm />}>
              {children}
            </Suspense>
          </main>
        </CspRoot>
      </div>
    </>
  );
}
