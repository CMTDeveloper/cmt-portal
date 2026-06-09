'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SetuLogo, SetuIcon } from '@cmt/ui';
import { SignOutButton } from '@/features/family/components/sign-out-button';

interface AdminSidebarProps {
  // href of the active nav item (from deriveAdminActive). '' = none highlighted.
  active?: string;
  displayEmail: string;
  hasFamily: boolean;
  showTeacher?: boolean;
}

const NAV_GROUPS: Array<{ heading: string; items: Array<{ label: string; href: string; legacy?: boolean }> }> = [
  { heading: 'People & access', items: [
    { label: 'Family search', href: '/welcome' },
    { label: 'Welcome-team grants', href: '/admin/welcome-team' },
  ]},
  { heading: 'Bala Vihar', items: [
    { label: 'Programs', href: '/admin/programs' },
    { label: 'Level management', href: '/admin/levels' },
    { label: 'Class calendar', href: '/admin/calendar' },
    { label: 'School year rollover', href: '/admin/school-year' },
    { label: 'Volunteering skills', href: '/admin/volunteering-skills' },
    { label: 'Seva', href: '/welcome/seva' },
  ]},
  { heading: 'Reports', items: [
    { label: 'Reports', href: '/check-in/admin/reports', legacy: true },
  ]},
  { heading: 'Legacy · door app', items: [
    { label: 'Admin users', href: '/check-in/admin/users', legacy: true },
    { label: 'Guests', href: '/check-in/admin/guests', legacy: true },
    { label: 'Unpaid', href: '/check-in/admin/unpaid', legacy: true },
    { label: 'Check-in dashboard', href: '/check-in/admin', legacy: true },
  ]},
];

/**
 * Map a pathname to the active admin-nav item's href. The admin sidebar is shown
 * on BOTH /admin/* and (for admins) /welcome/* — so this maps welcome surfaces
 * (search, seva) onto their admin-nav items. Returns '' when no item matches
 * (e.g. /admin/school-year, which is reached from a Dashboard tile, not the nav).
 */
export function deriveAdminActive(pathname: string): string {
  if (pathname.startsWith('/welcome/seva')) return '/welcome/seva';
  if (pathname.startsWith('/welcome')) return '/welcome'; // search + family detail
  if (pathname.startsWith('/admin/welcome-team')) return '/admin/welcome-team';
  if (pathname.startsWith('/admin/programs')) return '/admin/programs';
  if (pathname.startsWith('/admin/levels')) return '/admin/levels';
  if (pathname.startsWith('/admin/calendar')) return '/admin/calendar';
  if (pathname.startsWith('/admin/volunteering-skills')) return '/admin/volunteering-skills';
  if (pathname.startsWith('/admin/school-year')) return '/admin/school-year';
  if (pathname.startsWith('/admin/donation-periods')) return '/admin/donation-periods';
  if (pathname.startsWith('/check-in/admin/users')) return '/check-in/admin/users';
  if (pathname.startsWith('/check-in/admin/guests')) return '/check-in/admin/guests';
  if (pathname.startsWith('/check-in/admin/unpaid')) return '/check-in/admin/unpaid';
  if (pathname.startsWith('/check-in/admin/reports')) return '/check-in/admin/reports';
  if (pathname === '/check-in/admin') return '/check-in/admin';
  if (pathname === '/admin') return '/admin';
  return ''; // anything else → no highlight
}

// Pure — no hooks — so it can render inside a Suspense fallback (prerendered
// statically under Next 16 cacheComponents). For pathname-driven highlighting
// use AdminSidebarLive.
export function AdminSidebar({ active = '', displayEmail, hasFamily, showTeacher = false }: AdminSidebarProps) {
  return (
    <aside style={{ width: 248, background: 'var(--surface)', borderRight: '1px solid var(--line)', padding: '22px 18px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 28 }}><SetuLogo size={20}/></div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14 }}>
        {(hasFamily || showTeacher) && (
          <>
            {hasFamily && (
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
            )}
            {showTeacher && (
              <Link
                href="/teacher"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 'var(--radiusSm)',
                  color: 'var(--body-text)', fontWeight: 500, textDecoration: 'none',
                }}
              >
                <SetuIcon.people/>
                <span>Teacher</span>
              </Link>
            )}
            <div style={{ height: 1, background: 'var(--line)', margin: '8px 12px' }}/>
          </>
        )}
        {(() => {
          const dashboardActive = active !== '' && active === '/admin';
          return (
            <Link
              href="/admin"
              aria-current={dashboardActive ? 'page' : undefined}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '10px 12px', borderRadius: 'var(--radiusSm)',
                background: dashboardActive ? 'var(--accentSoft)' : 'transparent',
                color: dashboardActive ? 'var(--accentDeep)' : 'var(--body-text)',
                fontWeight: dashboardActive ? 600 : 500, textDecoration: 'none',
              }}
            >
              <span>Dashboard</span>
            </Link>
          );
        })()}
        {NAV_GROUPS.map((group, i) => (
          <div
            key={group.heading}
            style={{
              display: 'flex', flexDirection: 'column', gap: 2,
              // Structural break between groups so the section header reads as a
              // divider, not just another (muted) row.
              ...(i > 0 ? { marginTop: 8, paddingTop: 4, borderTop: '1px solid var(--line)' } : {}),
            }}
          >
            <div style={{ padding: '12px 12px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              {group.heading}
            </div>
            {group.items.map(({ label, href, legacy }) => {
              const isActive = active !== '' && href === active;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    padding: '10px 12px', borderRadius: 'var(--radiusSm)',
                    background: isActive ? 'var(--accentSoft)' : 'transparent',
                    color: isActive ? 'var(--accentDeep)' : 'var(--body-text)',
                    fontWeight: isActive ? 600 : 500, textDecoration: 'none',
                  }}
                >
                  <span>{label}</span>
                  {legacy && (
                    <span style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Legacy</span>
                  )}
                </Link>
              );
            })}
          </div>
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

// Live wrapper — derives the active item from the current pathname. Use this in
// the rendered chrome (inside a Suspense boundary), matching DesktopSidebarLive.
export function AdminSidebarLive(props: Omit<AdminSidebarProps, 'active'>) {
  const pathname = usePathname();
  return <AdminSidebar {...props} active={deriveAdminActive(pathname)} />;
}
