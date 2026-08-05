'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { signOut } from './sign-out-button';

/**
 * Bottom nav for the welcome section (/welcome), shown on every welcome page
 * including the drill-downs (family detail, single-level roster), which keep
 * their own back arrow as well.
 *
 * LAYOUT. ONE row: at most four destinations plus a "More" sheet holding the
 * rest and Sign out. This is the third revision and the reasoning is worth
 * keeping, because each fixed the previous one's damage:
 *
 *  1. `space-around` over a flat list of up to nine links. On a phone that gave
 *     each item ~40px and ran the labels together as one smear.
 *  2. A five-column GRID that wrapped to a second row - legible, but an admin
 *     sees nine cells, so it ALWAYS wrapped and ate a large piece of a screen
 *     whose whole job is showing a roster. Vaibhav, 2026-08-04, with a
 *     screenshot: *"can you make the bottom panel consistent on all page as
 *     it's now occupies large space. If you can have single row and rest of
 *     icons can go in popup menu"*.
 *  3. This one. Which is not a new idea - it is what `mobile-bottom-nav.tsx`
 *     (family) and `admin-mobile-nav.tsx` have always done. THIS bar was the
 *     only one that wrapped, so "consistent on all pages" was achieved by
 *     bringing the odd one into line rather than by changing all three.
 *
 * The three bars still hold their own copies of the sheet markup. Consolidating
 * them is worth doing, but not on the same day as a production fix: the family
 * bar carries external links, per-path hiding and staff-area entries that a
 * shared component has to grow API for, and families are using it right now.
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
}: WelcomeNavAudience): WelcomeNavItem[] {
  // Every audience that reaches this nav gets both boards.
  //
  // There used to be a `role` prop here, solely to run
  // `if (role !== 'coordinator') items.push(VISITORS)` - the board sat outside
  // the coordinator grant and the tab would have 302'd on tap. Coordinator
  // inherits the whole welcome-team grant as of 2026-08-05, so the gate would
  // now withhold a screen the role can open, and with it gone `role` had no
  // remaining reader HERE. The coordinator/welcome-team label distinction is
  // real but lives elsewhere: the welcome layout picks the sidebar's
  // displayName, and the FAMILY bottom nav switches on `staffArea`.
  const items: Item[] = [ROSTER, VISITORS];
  // Levels / Seva / Prasad / Reports became admin-only on 2026-08-03.
  if (isAdmin) items.push(LEVELS, SEVA, PRASAD, REPORTS);
  if (showTeacher) items.push({ href: '/teacher', label: 'Teacher', icon: 'people', match: under('/teacher') });
  if (isAdmin) items.push({ href: '/admin', label: 'Admin', icon: 'shield', match: under('/admin') });
  else if (hasFamily) items.push({ href: '/family', label: 'My family', icon: 'home', match: under('/family') });
  return items;
}

/**
 * How many destinations stay in the bar. The fifth cell is always "More", so
 * this is 5 columns on a ~390px screen - about 78px each, which holds an 11px
 * label without truncating.
 */
export const WELCOME_NAV_VISIBLE = 4;

/**
 * Split the audience's destinations into the bar and the sheet.
 *
 * Exported and pure so the split is testable without a router. Order is the
 * builder's, untouched: whatever a role's first four destinations are, they are
 * the four that stay put, and a role's bar never rearranges itself between
 * pages. Nothing is DROPPED - everything past the fourth moves to the sheet.
 */
export function splitWelcomeNavItems(items: WelcomeNavItem[]): {
  visible: WelcomeNavItem[];
  overflow: WelcomeNavItem[];
} {
  return { visible: items.slice(0, WELCOME_NAV_VISIBLE), overflow: items.slice(WELCOME_NAV_VISIBLE) };
}

export function WelcomeMobileNav(audience: WelcomeNavAudience) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { visible, overflow } = splitWelcomeNavItems(buildWelcomeNavItems(audience));

  // The sheet always exists, even with nothing overflowing: Sign out lives in
  // it. That is what frees the fifth cell for a destination instead.
  const overflowActive = overflow.some((i) => i.match(pathname));

  // Escape closes the sheet.
  //
  // On DOCUMENT, not on the overlay: opening the sheet leaves focus on the
  // "More" button, which sits OUTSIDE the overlay, so a handler on the overlay
  // would never receive the key. Without this a keyboard user can open the
  // sheet and has no way out but to activate a link inside it - the backdrop
  // click is no help to someone with no pointer. Flagged by Codex review; the
  // family and admin sheets have the same gap, tracked separately.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen]);

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

  const sheetLink: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 14px',
    borderRadius: 'var(--radiusSm)',
    textDecoration: 'none',
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--body-text)',
    background: 'transparent',
  };

  return (
    <>
      {moreOpen && (
        // `csp` so the sheet's brand tokens resolve outside any CspRoot.
        //
        // Deliberately NOT role="dialog" / aria-modal="true". A conformant modal
        // moves focus INTO itself and traps it there; this one does neither
        // (focus stays on the More button, which is why the Escape listener is
        // on document). Claiming the role anyway would announce "dialog, modal"
        // to a screen reader while focus and Tab order both said otherwise, and
        // would tell assistive tech the page behind is inert while a keyboard
        // user can still Tab straight into it. An honest non-modal popover that
        // closes on Escape is a real improvement; a mislabelled one is a
        // regression wearing a badge. Codex review, 2026-08-04 - the full
        // treatment lands with the shared component in the tracked follow-up.
        <div
          className="csp"
          onClick={() => setMoreOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.32)', display: 'flex', alignItems: 'flex-end' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxHeight: '80vh', overflowY: 'auto', background: 'var(--surface)', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '8px 10px max(16px, env(safe-area-inset-bottom))', boxShadow: '0 -8px 30px rgba(0,0,0,0.12)' }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 99, background: 'var(--line2)', margin: '6px auto 10px' }} />
            <div className="col" style={{ gap: 2 }}>
              {overflow.map((item) => {
                const Icon = SetuIcon[item.icon];
                const on = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    onClick={() => setMoreOpen(false)}
                    aria-current={on ? 'page' : undefined}
                    style={{
                      ...sheetLink,
                      color: on ? 'var(--accentDeep)' : 'var(--body-text)',
                      background: on ? 'var(--accentSoft)' : 'transparent',
                    }}
                  >
                    <Icon /> <span>{item.label}</span>
                  </Link>
                );
              })}
              {overflow.length > 0 && <div style={{ height: 1, background: 'var(--line)', margin: '6px 0' }} />}
              <button
                type="button"
                onClick={() => {
                  void signOut();
                }}
                style={{ ...sheetLink, width: '100%', border: 0, cursor: 'pointer', color: 'var(--muted)', fontFamily: 'var(--body)', textAlign: 'left' }}
              >
                <SetuIcon.user /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

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
          gridTemplateColumns: `repeat(${visible.length + 1}, minmax(0, 1fr))`,
          padding: '8px 4px max(16px, env(safe-area-inset-bottom))',
        }}
      >
        {visible.map((item) => {
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
          aria-label="More"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          // Lit when the CURRENT page is behind it. Without this a staff member
          // on an overflowed screen sees a bar with nothing highlighted and no
          // clue which of five taps got them there.
          style={{ ...cell, color: overflowActive || moreOpen ? 'var(--accent)' : 'var(--muted)' }}
        >
          <SetuIcon.dots /> More
        </button>
      </nav>
    </>
  );
}
