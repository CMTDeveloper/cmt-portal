import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveAdminActive } from '@/features/admin/components/admin-sidebar';

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
    const src = read('features/family/components/welcome-mobile-nav.tsx');
    expect(src).toContain('href="/welcome/visitors"');
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

  it('is excluded from the mobile nav Roster default', () => {
    const src = read('features/family/components/welcome-mobile-nav.tsx');
    // isRosterActive is a negated allowlist: Roster lights up for anything NOT
    // named there, so an omission is invisible until someone looks at the phone.
    const fn = /function isRosterActive[\s\S]*?\n}/.exec(src)?.[0] ?? '';
    expect(fn).toContain("'/welcome/visitors'");
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
