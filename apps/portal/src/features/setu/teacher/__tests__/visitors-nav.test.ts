import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveAdminActive } from '@/features/admin/components/admin-sidebar';
import { buildWelcomeNavItems } from '@/features/family/components/welcome-mobile-nav';

/**
 * /welcome/visitors has to be reachable from THREE navs, not one.
 * `welcome/layout.tsx` renders AdminSidebarLive for admins and DesktopSidebarLive
 * only for non-admin welcome-team, so wiring just WELCOME_NAV_ITEMS leaves the
 * page unreachable for every admin - and a page nobody can navigate to is the
 * failure mode this whole task exists to avoid.
 *
 * The two sidebars are 'use client' components whose nav tables are module-level
 * constants, not exports. Asserting on the source text is deliberately crude but
 * it is what actually catches the omission; rendering them would need a router
 * and would still not prove the OTHER sidebar was updated.
 */
const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('/welcome/visitors is reachable', () => {
  it('appears in the welcome-team desktop sidebar', () => {
    const src = read('features/family/components/desktop-sidebar.tsx');
    expect(src).toContain("'/welcome/visitors'");
  });

  it('appears in the ADMIN sidebar, which is the only one an admin sees', () => {
    const src = read('features/admin/components/admin-sidebar.tsx');
    expect(src).toContain("href: '/welcome/visitors'");
  });

  it('appears in the welcome mobile nav', () => {
    // Real assertion now, not a grep: the nav's items are built by an exported
    // pure function, so who sees which tab is checkable without a router.
    const hrefs = buildWelcomeNavItems({}).map((i) => i.href);
    expect(hrefs).toContain('/welcome/visitors');
  });
});

/**
 * Who sees which tab (2026-08-03). Welcome-team is scoped to the roster and the
 * visitors board; levels / seva / prasad / reports are admin-only. A tab a role
 * cannot reach is worse than no tab — it 302s to /sign-in on tap.
 */
describe('welcome mobile nav — role scoping', () => {
  const hrefs = (a: Parameters<typeof buildWelcomeNavItems>[0]) => buildWelcomeNavItems(a).map((i) => i.href);

  it('welcome-team gets the roster and the visitors board, and nothing else', () => {
    expect(hrefs({ role: 'welcome-team' })).toEqual(['/welcome/roster', '/welcome/visitors']);
  });

  it('a welcome-team member with their own family also gets a way back to it', () => {
    expect(hrefs({ role: 'welcome-team', hasFamily: true })).toEqual([
      '/welcome/roster',
      '/welcome/visitors',
      '/family',
    ]);
  });

  it('coordinator gets the roster only — the visitors board is not in that grant', () => {
    expect(hrefs({ role: 'coordinator' })).toEqual(['/welcome/roster']);
  });

  it('admin keeps every section, because /admin does not link levels or prasad', () => {
    expect(hrefs({ isAdmin: true })).toEqual([
      '/welcome/roster',
      '/welcome/visitors',
      '/welcome/levels',
      '/welcome/seva',
      '/welcome/prasad',
      '/welcome/reports',
      '/admin',
    ]);
  });

  it('the teacher tab is additive and does not displace a section', () => {
    expect(hrefs({ role: 'welcome-team', showTeacher: true })).toEqual([
      '/welcome/roster',
      '/welcome/visitors',
      '/teacher',
    ]);
  });
});

describe('/welcome/visitors highlights itself, not a sibling', () => {
  // Every one of the three navs resolves its active tab with an ordered list of
  // startsWith checks ending in a bare '/welcome' catch-all. A new section added
  // BELOW that catch-all silently highlights Roster/Family search instead.
  it('does not fall through to the admin sidebar /welcome catch-all', () => {
    expect(deriveAdminActive('/welcome/visitors')).toBe('/welcome/visitors');
    expect(deriveAdminActive('/welcome/visitors?date=2026-09-13')).toBe('/welcome/visitors');
    // The catch-all still works for what it is for.
    expect(deriveAdminActive('/welcome')).toBe('/welcome');
    expect(deriveAdminActive('/welcome/family/CMT-X')).toBe('/welcome');
  });

  it('no longer relies on a negated allowlist to stay out of Roster', () => {
    // This used to be `isRosterActive()`: Roster lit up for anything NOT named
    // in it, so a new section was silently absorbed until someone looked at a
    // phone. Each tab now owns its own matcher, so the property can be asserted
    // directly and holds for sections that do not exist yet.
    const items = buildWelcomeNavItems({ isAdmin: true });
    const roster = items.find((i) => i.href === '/welcome/roster')!;

    // Roster claims the section root and the family drill-down it links to.
    expect(roster.match('/welcome')).toBe(true);
    expect(roster.match('/welcome/roster')).toBe(true);
    expect(roster.match('/welcome/family/CMT-AB12CD34')).toBe(true);

    // ...and nothing else, including a section nobody has written yet.
    for (const p of ['/welcome/visitors', '/welcome/levels', '/welcome/seva', '/welcome/prasad', '/welcome/reports', '/welcome/some-future-section']) {
      expect(roster.match(p)).toBe(false);
    }

    // Exactly one tab lights up per path — no ties, no gaps.
    for (const item of items.filter((i) => i.href.startsWith('/welcome/'))) {
      expect(items.filter((i) => i.match(item.href))).toEqual([item]);
    }
  });

  it('is mapped ahead of the desktop sidebar /welcome catch-all', () => {
    const src = read('features/family/components/desktop-sidebar.tsx');
    const visitors = src.indexOf("if (pathname.startsWith('/welcome/visitors'))");
    const catchAll = src.indexOf("if (pathname.startsWith('/welcome')) return 'home';");
    expect(visitors).toBeGreaterThan(-1);
    expect(catchAll).toBeGreaterThan(-1);
    expect(visitors).toBeLessThan(catchAll);
  });
});
