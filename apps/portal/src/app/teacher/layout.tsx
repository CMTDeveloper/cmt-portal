import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isAdmin, isTeacher, type WithRole } from '@cmt/shared-domain';
import { CspRoot } from '@/features/family/components/atoms';
import { DesktopSidebarLive } from '@/features/family/components/desktop-sidebar';
import { TeacherTopBar } from '@/features/setu/teacher/components/teacher-top-bar';
import { LoadingOm } from '@/components/chrome/loading-om';
import { SchoolYearBadge } from '@/components/chrome/school-year-badge';

const DENIED = (
  <p style={{ color: 'var(--err)', fontSize: 14, padding: 32 }}>
    Access denied. Teacher role required.
  </p>
);

// The teacher area owns its chrome — added to chrome-wrapper's SUPPRESS_PATTERNS
// so the public marketing header never bleeds through. DESKTOP: the shared left
// sidebar (role="teacher": My classes · My family) + a content column, matching
// /family and /welcome. MOBILE: a phone-first sticky TeacherTopBar over a
// centered column (the attendance flow is phone-first).
//
// Defensive re-verify (middleware also gates /teacher → isTeacher). isTeacher
// passes a teacher-only role, a parent with extraRoles=['teacher'], and admin
// (inherits). No strict role equality. The bar/sidebar render regardless of
// `allowed` so a denied user can still sign out.
async function TeacherChrome({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  let allowed = false;
  let admin = false;
  if (sessionCookie) {
    const raw = await verifyPortalSessionCookie(sessionCookie).catch(() => null);
    if (raw) {
      const withRole = raw as unknown as WithRole;
      allowed = isTeacher(withRole);
      admin = isAdmin(withRole);
    }
  }
  const body = allowed ? children : DENIED;

  return (
    <>
      {/* Mobile — sticky top bar + centered content. The year badge is
          desktop-sidebar-only (matches /family + /welcome); putting it in the
          narrow mobile bar overflowed and overlapped the brand. */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
          <TeacherTopBar />
          <main style={{ flex: 1, maxWidth: 760, width: '100%', margin: '0 auto', padding: '24px 20px 48px' }}>
            {body}
          </main>
        </CspRoot>
      </div>

      {/* Desktop — shared left sidebar around a content column */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <DesktopSidebarLive
            role="teacher"
            subtitle="Teacher"
            showSignOut
            isAdmin={admin}
            yearBadge={<SchoolYearBadge />}
          />
          <main style={{ flex: 1, padding: '32px 48px', overflow: 'auto' }}>{body}</main>
        </CspRoot>
      </div>
    </>
  );
}

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<LoadingOm />}>
      <TeacherChrome>{children}</TeacherChrome>
    </Suspense>
  );
}
