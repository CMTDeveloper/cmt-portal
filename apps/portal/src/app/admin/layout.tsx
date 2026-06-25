import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isAdmin, isTeacher, type WithRole } from '@cmt/shared-domain';
import { flags } from '@/lib/flags';
import { CspRoot } from '@/features/family/components/atoms';
import { LoadingOm } from '@/components/chrome/loading-om';
import { AdminMobileNav } from '@/features/admin/components/admin-mobile-nav';
import { AdminSidebarLive } from '@/features/admin/components/admin-sidebar';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';
import { listKnownSchoolYears } from '@/features/setu/rollover/view-year';
import { SchoolYearScopeBar } from '@/features/setu/rollover/components/school-year-scope-bar';

// Themed admin chrome. Re-verifies admin role defensively (middleware already
// blocks non-admin, but the role check inside Suspense protects against
// future routing changes). Mirrors apps/portal/src/app/welcome/layout.tsx.

interface AdminIdentity {
  allowed: boolean;
  displayEmail: string;
  hasFamily: boolean;
  showTeacher: boolean;
}

async function resolveAdminIdentity(): Promise<AdminIdentity> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  let allowed = false;
  let displayEmail = 'Admin';
  let hasFamily = false;
  let showTeacher = false;
  if (sessionCookie) {
    const raw = await verifyPortalSessionCookie(sessionCookie).catch(() => null);
    // isAdmin() checks role OR extraRoles — a family-manager with
    // extraRoles=['admin'] passes here even though primary role is family.
    if (raw && isAdmin(raw as unknown as WithRole)) {
      allowed = true;
      const email = (raw as { email?: string }).email;
      if (email) displayEmail = email;
      // A family-manager-also-admin has fid in their claims; pure CMT sevaks
      // admins don't. We use this to show a "Back to family" link so dual-role
      // users can hop back to /family quickly.
      hasFamily = typeof (raw as { fid?: unknown }).fid === 'string';
      // Teacher cross-link: an admin who also teaches can hop to /teacher.
      // Gated on the feature flag + isTeacher(claims), mirroring isAdmin().
      showTeacher = flags.setuTeacher && isTeacher(raw as unknown as WithRole);
    }
  }
  return { allowed, displayEmail, hasFamily, showTeacher };
}

function AccessDenied() {
  return (
    <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
      <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Admin role required.</p>
    </div>
  );
}

async function AdminChromeAndChildren({ children }: { children: React.ReactNode }) {
  const { allowed, displayEmail, hasFamily, showTeacher } = await resolveAdminIdentity();
  if (!allowed) return <AccessDenied />;

  const db = portalFirestore();
  const liveYear = await getLiveSchoolYearCached();
  const years = await listKnownSchoolYears(db, liveYear);

  return (
    <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
      <AdminSidebarLive displayEmail={displayEmail} hasFamily={hasFamily} showTeacher={showTeacher} />
      <main style={{ flex: 1, padding: '32px 40px', overflow: 'auto' }}>
        <SchoolYearScopeBar years={years} liveYear={liveYear} canManage />
        {children}
      </main>
    </CspRoot>
  );
}

// Mobile admin chrome: a CspRoot wrapper (so brand tokens resolve — without it
// the page renders unstyled, tiles lose their card backgrounds/borders) plus a
// fixed bottom nav. Sign out + Back-to-family live in the nav's "More" sheet,
// mirroring the family mobile chrome.
async function AdminMobileChrome({ children }: { children: React.ReactNode }) {
  const { allowed, hasFamily, showTeacher } = await resolveAdminIdentity();
  if (!allowed) return <AccessDenied />;

  const db = portalFirestore();
  const liveYear = await getLiveSchoolYearCached();
  const years = await listKnownSchoolYears(db, liveYear);

  return (
    <CspRoot style={{ minHeight: '100dvh' }}>
      <div style={{ padding: '18px 18px 90px' }}>
        <SchoolYearScopeBar years={years} liveYear={liveYear} canManage />
        {children}
      </div>
      <AdminMobileNav hasFamily={hasFamily} showTeacher={showTeacher} />
    </CspRoot>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Mobile: themed chrome (CspRoot + top bar). */}
      <div className="block md:hidden">
        <Suspense fallback={<LoadingOm />}>
          <AdminMobileChrome>{children}</AdminMobileChrome>
        </Suspense>
      </div>
      {/* Desktop: themed chrome */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <Suspense fallback={<LoadingOm />}>
          <AdminChromeAndChildren>{children}</AdminChromeAndChildren>
        </Suspense>
      </div>
    </>
  );
}
