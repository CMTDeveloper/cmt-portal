import { Suspense } from 'react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isAdmin, type WithRole } from '@cmt/shared-domain';
import { SetuLogo, SetuIcon } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { LoadingOm } from '@/components/chrome/loading-om';
import { SignOutButton } from '@/features/family/components/sign-out-button';
import { AdminMobileNav } from '@/features/admin/components/admin-mobile-nav';

// Themed admin chrome. Re-verifies admin role defensively (middleware already
// blocks non-admin, but the role check inside Suspense protects against
// future routing changes). Mirrors apps/portal/src/app/welcome/layout.tsx.

interface AdminIdentity {
  allowed: boolean;
  displayEmail: string;
  hasFamily: boolean;
}

async function resolveAdminIdentity(): Promise<AdminIdentity> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  let allowed = false;
  let displayEmail = 'Admin';
  let hasFamily = false;
  if (sessionCookie) {
    const raw = await verifyPortalSessionCookie(sessionCookie).catch(() => null);
    // isAdmin() checks role OR extraRoles — a family-manager with
    // extraRoles=['admin'] passes here even though primary role is family.
    if (raw && isAdmin(raw as unknown as WithRole)) {
      allowed = true;
      const email = (raw as { email?: string }).email;
      if (email) displayEmail = email;
      // A family-manager-also-admin has fid in their claims; pure CMT staff
      // admins don't. We use this to show a "Back to family" link so dual-role
      // users can hop back to /family quickly.
      hasFamily = typeof (raw as { fid?: unknown }).fid === 'string';
    }
  }
  return { allowed, displayEmail, hasFamily };
}

function AccessDenied() {
  return (
    <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
      <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Admin role required.</p>
    </div>
  );
}

async function AdminChromeAndChildren({ children }: { children: React.ReactNode }) {
  const { allowed, displayEmail, hasFamily } = await resolveAdminIdentity();
  if (!allowed) return <AccessDenied />;

  return (
    <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
      <AdminSidebar displayEmail={displayEmail} hasFamily={hasFamily}/>
      <main style={{ flex: 1, padding: '32px 40px', overflow: 'auto' }}>{children}</main>
    </CspRoot>
  );
}

// Mobile admin chrome: a CspRoot wrapper (so brand tokens resolve — without it
// the page renders unstyled, tiles lose their card backgrounds/borders) plus a
// fixed bottom nav. Sign out + Back-to-family live in the nav's "More" sheet,
// mirroring the family mobile chrome.
async function AdminMobileChrome({ children }: { children: React.ReactNode }) {
  const { allowed, hasFamily } = await resolveAdminIdentity();
  if (!allowed) return <AccessDenied />;

  return (
    <CspRoot style={{ minHeight: '100dvh' }}>
      <div style={{ padding: '18px 18px 90px' }}>{children}</div>
      <AdminMobileNav hasFamily={hasFamily} />
    </CspRoot>
  );
}

function AdminSidebar({ displayEmail, hasFamily }: { displayEmail: string; hasFamily: boolean }) {
  const items: Array<{ label: string; href: string; legacy?: boolean }> = [
    { label: 'Dashboard',          href: '/admin' },
    { label: 'Family search',      href: '/welcome' },
    { label: 'Welcome-team grants',href: '/admin/welcome-team' },
    { label: 'Programs',           href: '/admin/programs' },
    { label: 'Levels & teachers',  href: '/admin/levels' },
    { label: 'Class calendar',     href: '/admin/calendar' },
    { label: 'Admin users',        href: '/check-in/admin/users',   legacy: true },
    { label: 'Guests',             href: '/check-in/admin/guests',  legacy: true },
    { label: 'Unpaid',             href: '/check-in/admin/unpaid',  legacy: true },
    { label: 'Reports',            href: '/check-in/admin/reports', legacy: true },
  ];
  return (
    <aside style={{ width: 248, background: 'var(--surface)', borderRight: '1px solid var(--line)', padding: '22px 18px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 28 }}><SetuLogo size={20}/></div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14 }}>
        {hasFamily && (
          <>
            <Link
              href="/family"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 'var(--radiusSm)',
                color: 'var(--body-text)', fontWeight: 500, textDecoration: 'none',
              }}
            >
              <SetuIcon.back/>
              <span>Back to my family</span>
            </Link>
            <div style={{ height: 1, background: 'var(--line)', margin: '8px 12px' }}/>
          </>
        )}
        {items.map(({ label, href, legacy }) => (
          <Link key={href} href={href} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '10px 12px', borderRadius: 'var(--radiusSm)',
            color: 'var(--body-text)', fontWeight: 500, textDecoration: 'none',
          }}>
            <span>{label}</span>
            {legacy && (
              <span style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Legacy</span>
            )}
          </Link>
        ))}
      </nav>
      <div style={{ marginTop: 'auto', padding: 14, background: 'var(--bg)', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>
            <SetuIcon.user/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Admin</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayEmail}</div>
          </div>
        </div>
        <SignOutButton showIcon={false} style={{
          marginTop: 10, width: '100%', background: 'transparent', border: '1px solid var(--line2)',
          borderRadius: 'var(--radiusSm)', padding: '6px 10px', fontSize: 12, color: 'var(--muted)',
          fontFamily: 'var(--body)', fontWeight: 500, cursor: 'pointer',
        }}/>
      </div>
    </aside>
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
