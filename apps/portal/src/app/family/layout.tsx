import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { CspRoot } from '@/features/family/components/atoms';
import { DesktopSidebar, DesktopSidebarLive } from '@/features/family/components/desktop-sidebar';
import { MobileBottomNav } from '@/features/family/components/mobile-bottom-nav';
import { LoadingOm } from '@/components/chrome/loading-om';
import { SchoolYearBadge } from '@/components/chrome/school-year-badge';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import {
  isAdmin,
  isTeacher,
  incompleteMembers,
  isMemberComplete,
  isFamilyAddressComplete,
  type WithRole,
} from '@cmt/shared-domain';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getDisclaimerStateForFamily } from '@/features/setu/disclaimers/acceptance';
import { flags } from '@/lib/flags';

// Route the gate redirects an incomplete family to. It lives at a TOP-LEVEL
// route, OUTSIDE this /family layout, on purpose. When the completion screen was
// nested at /family/complete-profile it inherited THIS gate, which then had to
// exempt itself via the current request pathname — and under a soft client-side
// navigation that header is stale (it read '/family' while the layout
// re-rendered for the completion route), so the gate redirected to itself
// forever: a blank page with flickering chrome. Redirecting OUTSIDE /family
// means the gate never re-runs at the destination — no exemption to get wrong,
// nothing to loop.
const COMPLETE_PROFILE_PATH = '/complete-profile';

// Profile-completion gate (owner spec 2026-06-22). Runs on every /family/*
// render. A MANAGER must complete the WHOLE family (children included — they
// don't sign in); a plain family-MEMBER is gated only on their own record
// (canAccessRoute lets a member edit only themselves). The completeness rules
// come from the single shared @cmt/shared-domain helper so the gate, the forms,
// and the write routes all agree.
export async function ProfileCompletionGate() {
  // flags.setuAuth false ⇒ the mock/prototype path with no real session; the
  // dashboard renders its mock family and there's nothing to gate.
  if (!flags.setuAuth) return null;

  const data = await getCurrentFamily();
  if (!data) return null; // unauthenticated — middleware already handles redirect

  const incomplete = data.isManager
    ? incompleteMembers(data.members).length > 0 || !isFamilyAddressComplete(data.family)
    : (() => {
        const me = data.members.find((m) => m.mid === data.currentMid);
        // No own record found ⇒ nothing this member can complete; don't trap them.
        return me ? !isMemberComplete(me) : false;
      })();

  if (incomplete) redirect(COMPLETE_PROFILE_PATH);
  return null;
}

// Disclaimer-acceptance gate (Slice 2). Runs on every /family/* render AFTER the
// profile gate. Per-family: only the MANAGER accepts. Redirects to the top-level
// /disclaimers screen (OUTSIDE this layout, like /complete-profile) when the
// family's acceptance isn't current (stale version or new school year). Flag-gated
// OFF by default. Guards on profile-completeness so the profile gate always runs
// first regardless of Suspense resolution order.
export async function DisclaimerGate() {
  if (!flags.setuDisclaimers) return null;

  const data = await getCurrentFamily();
  if (!data) return null; // unauthenticated — middleware handles it
  if (!data.isManager) return null; // per-family: members aren't gated
  // Defer to ProfileCompletionGate if the profile is still incomplete (missing
  // member fields OR the required family home address — both are profile data
  // collected before disclaimers).
  if (incompleteMembers(data.members).length > 0 || !isFamilyAddressComplete(data.family)) return null;

  const state = await getDisclaimerStateForFamily(portalFirestore(), data.family);
  if (!state.accepted) redirect('/acknowledgements');
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
    // Show the friendly publicFid only when it is set (Model Y2 mints it at first
    // enrollment); the internal CMT- id is never shown on this family-facing
    // sidebar. The legacy check-in id still shows when present.
    const fidClause = data.family.publicFid ? ` · FID ${data.family.publicFid}` : '';
    const legacyClause = data.family.legacyFid ? ` · Legacy ${data.family.legacyFid}` : '';
    subtitle = `${data.family.name}${fidClause}${legacyClause}`;
  }
  return <DesktopSidebarLive displayName={displayName} subtitle={subtitle} showSignOut isAdmin={sevak.isAdmin} showTeacher={sevak.showTeacher} yearBadge={<SchoolYearBadge />}/>;
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

      {/* Disclaimer-acceptance gate (Slice 2). Its own Suspense boundary; renders
          AFTER the profile gate. Renders nothing — it either redirects to
          /disclaimers (a not-yet-accepted manager) or no-ops. */}
      <Suspense fallback={null}>
        <DisclaimerGate />
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
