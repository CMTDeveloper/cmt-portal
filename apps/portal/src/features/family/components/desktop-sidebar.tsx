'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SetuLogo, SetuAvatar, SetuIcon } from '@cmt/ui';
import { signOut } from './sign-out-button';

type SidebarTab = 'home' | 'family' | 'bv' | 'programs' | 'calendar' | 'giving' | 'receipts' | 'security' | 'levels' | 'seva' | 'reports' | 'prasad';

interface DesktopSidebarProps {
  active?: SidebarTab;
  role?: 'family' | 'welcome-team';
  displayName?: string | undefined;
  subtitle?: string | undefined;
  showSignOut?: boolean;
  // When true, a separate "Admin" link appears at the bottom of the family
  // nav. The family layout passes this based on isAdmin(claims), which is
  // true for both primary admins and family members with admin in extraRoles
  // (via roleAssignments/{mid}). Welcome-team-only sidebar ignores this flag.
  isAdmin?: boolean;
  // When true, a "Teacher" link appears in the Sevak section. Gated on
  // flags.setuTeacher && isTeacher(claims) by the layout. Unlike the Admin
  // link this shows in both the family AND welcome-team sidebars (a teacher
  // may be browsing either surface), so it's gated on showTeacher alone.
  showTeacher?: boolean;
}

const FAMILY_NAV_ITEMS: [SidebarTab, string, keyof typeof SetuIcon, string][] = [
  ['home',     'Home',           'home',    '/family'],
  ['family',   'My family',      'people',  '/family/members'],
  ['programs', 'Programs',       'grid',    '/family/programs'],
  ['seva',     'Seva',           'heart',   '/family/seva'],
  ['calendar', 'Calendar',       'calendar','/family/calendar'],
  // Giving + Receipts intentionally omitted: general donations are handled via a
  // separate CMT process/site, not Stripe-in-portal (CMT decision 2026-06-04).
  // The Bala Vihar dakshina flow stays reachable from the dashboard / enroll.
  ['security', 'Sign-in security','shield', '/family/settings/security'],
];

const WELCOME_NAV_ITEMS: [SidebarTab, string, keyof typeof SetuIcon, string, boolean?][] = [
  ['home', 'Roster',            'search',  '/welcome/roster'],
  ['reports', 'Reports',        'info',    '/welcome/reports'],
  ['levels', 'Levels & rosters','people',  '/welcome/levels'],
  ['seva',   'Seva',            'heart',   '/welcome/seva'],
  ['prasad', 'Prasad',          'bell',    '/welcome/prasad'],
  ['family', 'Pending',         'people',  '/welcome', true],
  ['bv',     'Donation periods','calendar','/welcome', true],
];

function deriveActiveFromPathname(pathname: string): SidebarTab {
  if (pathname.startsWith('/family/members')) return 'family';
  if (pathname.startsWith('/family/calendar')) return 'calendar';
  // All program enrollment (incl. Bala Vihar) routes through Programs now.
  if (pathname.startsWith('/family/enroll')) return 'programs';
  if (pathname.startsWith('/family/programs')) return 'programs';
  if (pathname.startsWith('/family/donate') && !pathname.startsWith('/family/donations')) return 'giving';
  if (pathname.startsWith('/family/donations')) return 'receipts';
  if (pathname.startsWith('/family/settings/security')) return 'security';
  if (pathname.startsWith('/family/seva')) return 'seva';
  if (pathname.startsWith('/family')) return 'home';
  if (pathname.startsWith('/welcome/levels')) return 'levels';
  if (pathname.startsWith('/welcome/seva')) return 'seva';
  if (pathname.startsWith('/welcome/reports')) return 'reports';
  if (pathname.startsWith('/welcome/prasad')) return 'prasad';
  if (pathname.startsWith('/welcome')) return 'home';
  return 'home';
}

// DesktopSidebar is pure — it does not call hooks. This lets it render inside
// Suspense fallbacks (which Next.js 16 cacheComponents prerenders statically).
// For pathname-driven self-highlighting, use DesktopSidebarLive instead.
export function DesktopSidebar({ active, role = 'family', displayName, subtitle, showSignOut, isAdmin, showTeacher = false }: DesktopSidebarProps) {
  const navItems = role === 'welcome-team' ? WELCOME_NAV_ITEMS : FAMILY_NAV_ITEMS;
  const trimmed = (displayName ?? '').trim();
  const name = trimmed || (role === 'welcome-team' ? 'Welcome team' : 'Family member');
  // Show the "Admin" shortcut whenever the signed-in user is an admin — in BOTH
  // the family and welcome-team sidebars. /welcome pages (search, seva) are
  // shared admin surfaces an admin reaches from the admin nav; without this link
  // they'd be stranded in welcome chrome with no route back to /admin.
  const showAdminLink = isAdmin === true;
  // The Sevak section renders if EITHER a sevak cross-link is available. Teacher
  // is gated on showTeacher alone (shows in both family + welcome sidebars).
  const showSevakSection = showAdminLink || showTeacher;

  return (
    <aside style={{ width: 248, background: 'var(--surface)', borderRight: '1px solid var(--line)', padding: '22px 18px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 28 }}><SetuLogo size={20}/></div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14 }}>
        {navItems.map(([id, label, iconKey, href, disabled]) => {
          const Icon = SetuIcon[iconKey];
          const a = id === active && !disabled;
          return disabled ? (
            <div key={id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
              borderRadius: 'var(--radiusSm)',
              color: 'var(--muted)', fontWeight: 500, opacity: 0.5, cursor: 'not-allowed',
            }}>
              <Icon/> {label}
              <span style={{ marginLeft: 'auto', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase' }}>Soon</span>
            </div>
          ) : (
            <Link key={id} href={href} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
              borderRadius: 'var(--radiusSm)',
              background: a ? 'var(--accentSoft)' : 'transparent',
              color: a ? 'var(--accentDeep)' : 'var(--body-text)',
              fontWeight: a ? 600 : 500, textDecoration: 'none',
            }}>
              <Icon/> {label}
            </Link>
          );
        })}
        {showSevakSection && (
          <>
            <div style={{ marginTop: 14, marginBottom: 6, padding: '0 12px', fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Sevak
            </div>
            {showAdminLink && (
              <Link
                href="/admin"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  borderRadius: 'var(--radiusSm)',
                  background: 'transparent',
                  color: 'var(--body-text)',
                  fontWeight: 500, textDecoration: 'none',
                }}
              >
                <SetuIcon.shield/> Admin
              </Link>
            )}
            {showTeacher && (
              <Link
                href="/teacher"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  borderRadius: 'var(--radiusSm)',
                  background: 'transparent',
                  color: 'var(--body-text)',
                  fontWeight: 500, textDecoration: 'none',
                }}
              >
                <SetuIcon.people/> Teacher
              </Link>
            )}
          </>
        )}
      </nav>
      <div style={{ marginTop: 'auto', padding: 14, background: 'var(--bg)', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line)' }}>
        <div className="row" style={{ gap: 10 }}>
          <SetuAvatar name={name} size={32}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            {subtitle && <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>}
          </div>
        </div>
        {showSignOut && (
          <button
            onClick={() => { void signOut(); }}
            style={{
              marginTop: 10, width: '100%', background: 'transparent', border: '1px solid var(--line2)',
              borderRadius: 'var(--radiusSm)', padding: '6px 10px', fontSize: 12, color: 'var(--muted)',
              cursor: 'pointer', fontFamily: 'var(--body)', fontWeight: 500,
            }}
          >
            Sign out
          </button>
        )}
      </div>
    </aside>
  );
}

// Live wrapper that derives the active tab from the current pathname. Use this
// for the actual rendered sidebar (inside a Suspense boundary). The Suspense
// fallback should use the bare DesktopSidebar so it can prerender statically.
export function DesktopSidebarLive(props: Omit<DesktopSidebarProps, 'active'>) {
  const pathname = usePathname();
  const active = deriveActiveFromPathname(pathname);
  return <DesktopSidebar {...props} active={active} />;
}
