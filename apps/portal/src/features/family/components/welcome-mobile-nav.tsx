'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { signOut } from './sign-out-button';

/**
 * Bottom nav for the welcome section (/welcome), shown on every welcome page
 * including the drill-downs (family detail, single-level roster), which keep
 * their own back arrow as well.
 *
 * LAYOUT. This used to be `justify-content: space-around` over a flat list of
 * up to nine links, which on a phone gave each item ~40px and ran the labels
 * into each other ("Roster Levels Seva Visitors…" as one smear). It is a GRID
 * now: at most five columns, wrapping to a second row. Five columns of a 390px
 * screen is ~78px per cell, which comfortably holds an 11px label, and adding a
 * tenth destination costs a row rather than legibility.
 *
 * ROLES (2026-08-03). Welcome-team is scoped to the roster and the visitors
 * board; levels / seva / prasad / reports are admin-only. Every item here is
 * reachable by the role that sees it — a tab that 302s on tap is worse than no
 * tab. The admin keeps all six because /admin links to seva and reports but NOT
 * to /welcome/levels or /welcome/prasad, so this bar is their only way in.
 */

export type WelcomeNavItem = {
  href: string;
  label: string;
  icon: keyof typeof SetuIcon;
  /** Which paths light this tab up. Owned by the item, never by a sibling. */
  match: (pathname: string) => boolean;
};

type Item = WelcomeNavItem;

const under = (base: string) => (p: string) => p === base || p.startsWith(`${base}/`);

// Roster is the section's home: /welcome itself redirects to it, and every
// family drill-down is reached from it.
const ROSTER: Item = {
  href: '/welcome/roster',
  label: 'Roster',
  icon: 'search',
  match: (p) => p === '/welcome' || under('/welcome/roster')(p) || under('/welcome/family')(p),
};
const VISITORS: Item = { href: '/welcome/visitors', label: 'Visitors', icon: 'bell', match: under('/welcome/visitors') };
const LEVELS: Item = { href: '/welcome/levels', label: 'Levels', icon: 'people', match: under('/welcome/levels') };
const SEVA: Item = { href: '/welcome/seva', label: 'Seva', icon: 'heart', match: under('/welcome/seva') };
const PRASAD: Item = { href: '/welcome/prasad', label: 'Prasad', icon: 'bell', match: under('/welcome/prasad') };
const REPORTS: Item = { href: '/welcome/reports', label: 'Reports', icon: 'info', match: under('/welcome/reports') };

export interface WelcomeNavAudience {
  isAdmin?: boolean;
  hasFamily?: boolean;
  showTeacher?: boolean;
  role?: 'welcome-team' | 'coordinator';
}

/**
 * The tabs a given audience gets. Exported so the role scoping is testable
 * without a router — the previous version encoded it in JSX and could only be
 * checked by grepping this file's own source text.
 */
export function buildWelcomeNavItems({
  isAdmin = false,
  hasFamily = false,
  showTeacher = false,
  role = 'welcome-team',
}: WelcomeNavAudience): WelcomeNavItem[] {
  const items: Item[] = [ROSTER];
  // Coordinator's grant is Programs + Levels + Roster; the visitors board is not
  // part of it, so the tab would 302 on tap.
  if (role !== 'coordinator') items.push(VISITORS);
  // Levels / Seva / Prasad / Reports became admin-only on 2026-08-03.
  if (isAdmin) items.push(LEVELS, SEVA, PRASAD, REPORTS);
  if (showTeacher) items.push({ href: '/teacher', label: 'Teacher', icon: 'people', match: under('/teacher') });
  if (isAdmin) items.push({ href: '/admin', label: 'Admin', icon: 'shield', match: under('/admin') });
  else if (hasFamily) items.push({ href: '/family', label: 'My family', icon: 'home', match: under('/family') });
  return items;
}

export function WelcomeMobileNav(audience: WelcomeNavAudience) {
  const pathname = usePathname();
  const items = buildWelcomeNavItems(audience);

  // Never more than five per row; the sign-out button occupies the last cell.
  const columns = Math.min(items.length + 1, 5);

  const cell: React.CSSProperties = {
    background: 'transparent',
    border: 0,
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    padding: '6px 2px',
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'var(--body)',
    lineHeight: 1.1,
    textAlign: 'center',
    minWidth: 0,
    whiteSpace: 'nowrap',
  };

  return (
    <nav
      aria-label="Welcome team"
      className="csp"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        background: 'var(--surface)',
        borderTop: '1px solid var(--line)',
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        rowGap: 2,
        padding: '8px 4px 16px',
      }}
    >
      {items.map((item) => {
        const on = item.match(pathname);
        // Module-level component reference, so this is a stable type across
        // renders (never a component declared inside another component).
        const Icon = SetuIcon[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            // Chrome navigation does not prefetch — see NAV_PREFETCH in
            // desktop-sidebar.tsx for the measurement behind this.
            prefetch={false}
            aria-current={on ? 'page' : undefined}
            style={{ ...cell, color: on ? 'var(--accent)' : 'var(--muted)' }}
          >
            <Icon />
            {item.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
        style={{ ...cell, color: 'var(--muted)' }}
      >
        <SetuIcon.user /> Sign out
      </button>
    </nav>
  );
}
