'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SetuLogo, SetuAvatar, SetuIcon } from '@cmt/ui';
import { signOut } from './sign-out-button';

type SidebarTab = 'home' | 'family' | 'bv' | 'programs' | 'calendar' | 'giving' | 'receipts' | 'security' | 'levels';

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
}

const FAMILY_NAV_ITEMS: [SidebarTab, string, keyof typeof SetuIcon, string][] = [
  ['home',     'Home',           'home',    '/family'],
  ['family',   'My family',      'people',  '/family/members'],
  ['bv',       'Bala Vihar',     'check',   '/family/enroll'],
  ['programs', 'Programs',       'grid',    '/family/programs'],
  ['calendar', 'Calendar',       'calendar','/family/calendar'],
  ['giving',   'Giving',         'heart',   '/family/donate'],
  ['receipts', 'Receipts',       'receipt', '/family/donations'],
  ['security', 'Sign-in security','shield', '/family/settings/security'],
];

const WELCOME_NAV_ITEMS: [SidebarTab, string, keyof typeof SetuIcon, string, boolean?][] = [
  ['home', 'Search',            'search',  '/welcome'],
  ['levels', 'Levels & rosters','people',  '/welcome/levels'],
  ['family', 'Pending',         'people',  '/welcome', true],
  ['bv',     'Donation periods','calendar','/welcome', true],
];

function deriveActiveFromPathname(pathname: string): SidebarTab {
  if (pathname.startsWith('/family/members')) return 'family';
  if (pathname.startsWith('/family/calendar')) return 'calendar';
  // BV enroll (the redirect target /family/enroll and /family/enroll/bala-vihar)
  // highlights Bala Vihar; enrolling in any OTHER program highlights Programs
  // (that's where the family reached it from).
  if (pathname === '/family/enroll' || pathname.startsWith('/family/enroll/bala-vihar')) return 'bv';
  if (pathname.startsWith('/family/enroll')) return 'programs';
  if (pathname.startsWith('/family/programs')) return 'programs';
  if (pathname.startsWith('/family/donate') && !pathname.startsWith('/family/donations')) return 'giving';
  if (pathname.startsWith('/family/donations')) return 'receipts';
  if (pathname.startsWith('/family/settings/security')) return 'security';
  if (pathname.startsWith('/family')) return 'home';
  if (pathname.startsWith('/welcome/levels')) return 'levels';
  if (pathname.startsWith('/welcome')) return 'home';
  return 'home';
}

// DesktopSidebar is pure — it does not call hooks. This lets it render inside
// Suspense fallbacks (which Next.js 16 cacheComponents prerenders statically).
// For pathname-driven self-highlighting, use DesktopSidebarLive instead.
export function DesktopSidebar({ active, role = 'family', displayName, subtitle, showSignOut, isAdmin }: DesktopSidebarProps) {
  const navItems = role === 'welcome-team' ? WELCOME_NAV_ITEMS : FAMILY_NAV_ITEMS;
  const trimmed = (displayName ?? '').trim();
  const name = trimmed || (role === 'welcome-team' ? 'Welcome team' : 'Family member');
  // Only show the admin shortcut on the family sidebar (welcome-team already
  // has its own routes). Admins still navigate via /admin URLs — this is
  // just a convenience link so they don't have to type the path.
  const showAdminLink = role === 'family' && isAdmin === true;

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
        {showAdminLink && (
          <>
            <div style={{ marginTop: 14, marginBottom: 6, padding: '0 12px', fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Staff
            </div>
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
