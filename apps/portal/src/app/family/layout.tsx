import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getRequestPathname } from '@/features/setu/members/get-request-pathname';
import { CspRoot } from '@/features/family/components/atoms';
import { DesktopSidebar, DesktopSidebarLive } from '@/features/family/components/desktop-sidebar';
import { MobileBottomNav } from '@/features/family/components/mobile-bottom-nav';
import { LoadingOm } from '@/components/chrome/loading-om';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import {
  isAdmin,
  isTeacher,
  incompleteMembers,
  isMemberComplete,
  type WithRole,
} from '@cmt/shared-domain';
import { flags } from '@/lib/flags';

// Route the gate redirects an incomplete family to. Exempted from the gate
// itself so the completion screen can render (no infinite redirect loop).
const COMPLETE_PROFILE_PATH = '/family/complete-profile';

// Profile-completion gate (owner spec 2026-06-22). Runs on every /family/*
// render. A MANAGER must complete the WHOLE family (children included — they
// don't sign in); a plain family-MEMBER is gated only on their own record
// (canAccessRoute lets a member edit only themselves). The completeness rules
// come from the single shared @cmt/shared-domain helper so the gate, the forms,
// and the write routes all agree.
//
// Loop-safety: we only redirect once we can positively confirm the current
// pathname is NOT the completion route. getRequestPathname() fails open
// (returns null) when the path can't be determined, in which case we DON'T
// redirect — a missing pathname can never lock a family out or loop.
export async function ProfileCompletionGate() {
  // flags.setuAuth false ⇒ the mock/prototype path with no real session; the
  // dashboard renders its mock family and there's nothing to gate.
  if (!flags.setuAuth) return null;

  const [data, pathname] = await Promise.all([getCurrentFamily(), getRequestPathname()]);
  if (!data) return null; // unauthenticated — middleware already handles redirect

  // Already on the completion screen → never redirect (would loop). Also the
  // fail-open case: unknown pathname ⇒ don't redirect.
  if (pathname === null || pathname === COMPLETE_PROFILE_PATH) return null;

  let incomplete: boolean;
  if (data.isManager) {
    incomplete = incompleteMembers(data.members).length > 0;
  } else {
    const me = data.members.find((m) => m.mid === data.currentMid);
    // No own record found ⇒ nothing this member can complete; don't trap them.
    incomplete = me ? !isMemberComplete(me) : false;
  }

  if (incomplete) redirect(COMPLETE_PROFILE_PATH);
  return null;
}

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
      {/* Profile-completion gate. Its own Suspense boundary (it awaits the
          session + family + pathname) so the static shell still streams under
          cacheComponents. Renders nothing — it either redirects or no-ops. */}
      <Suspense fallback={null}>
        <ProfileCompletionGate />
      </Suspense>

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
