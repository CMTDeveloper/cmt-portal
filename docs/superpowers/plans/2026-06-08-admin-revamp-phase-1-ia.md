# Admin Revamp — Phase 1: IA Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin area legible at a glance — group the 13 flat tiles into four labelled sections (People & access · Bala Vihar · Reports · Legacy · door app), mirror that grouping in the desktop sidebar and mobile nav, and rename "Levels & teachers" → "Level management". No new routes; no behavior change.

**Architecture:** Pure presentation/IA refactor of three client/server components. The three tools that get *replaced* in later phases (Welcome-team grants → Users & roles, Family search → Roster, legacy Reports → Reports hub) keep their **current routes and labels** in Phase 1 — each later phase re-points its own entry and adds a redirect, so there are never dead links.

**Tech Stack:** Next.js 16 App Router, React, Setu `.csp` brand tokens, Vitest + Testing Library (jsdom project for `*.test.tsx`).

**Design ref:** `docs/superpowers/specs/2026-06-08-admin-section-revamp-design.md` (Phase 1 section).

**Standing constraints:** UI/UX designer pass + a real mobile-viewport check on every UI task; `.csp` token scoping (anything outside a `CspRoot` needs `className="csp"`); `exactOptionalPropertyTypes`; tests ship in the same commit; never `--no-verify`; `git push` after each authorized commit; subagents on Opus.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `apps/portal/src/app/admin/levels/page.tsx` | Level config + teacher assignment page | Rename copy only (metadata title, `<h1>`) |
| `apps/portal/src/app/admin/page.tsx` | Admin dashboard landing | Restructure flat tile grid → 4 grouped sections; rename Levels tile |
| `apps/portal/src/features/admin/components/admin-sidebar.tsx` | Desktop admin sidebar nav | Flat `ADMIN_NAV` → grouped sections with headers; rename Levels; map `/admin/school-year` active |
| `apps/portal/src/features/admin/components/__tests__/admin-sidebar.test.tsx` | Sidebar tests | Update label + school-year active assertions; add group-header assertions |
| `apps/portal/src/features/admin/components/admin-mobile-nav.tsx` | Admin mobile bottom nav + "More" sheet | Align sheet grouping/labels with the rename; verify parity |
| `apps/portal/src/app/admin/__tests__/page.test.tsx` (new) | Dashboard structure test | New — assert the 4 section headings render |

---

## Task 1: Rename "Levels & teachers" → "Level management"

**Files:**
- Modify: `apps/portal/src/app/admin/levels/page.tsx:10,71-76`
- Modify: `apps/portal/src/features/admin/components/admin-sidebar.tsx:21`
- Modify: `apps/portal/src/app/admin/page.tsx:56-60` (tile title + sub)
- Test: `apps/portal/src/features/admin/components/__tests__/admin-sidebar.test.tsx`

- [ ] **Step 1: Write the failing test** — add to the `AdminSidebar` describe block in `admin-sidebar.test.tsx`:

```tsx
  it('renders the renamed "Level management" nav item at /admin/levels', () => {
    render(<AdminSidebar displayEmail="a@b.com" hasFamily={false} />);
    const link = screen.getByRole('link', { name: 'Level management' });
    expect(link.getAttribute('href')).toBe('/admin/levels');
    expect(screen.queryByRole('link', { name: 'Levels & teachers' })).toBeNull();
  });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/admin/components/__tests__/admin-sidebar.test.tsx`
Expected: FAIL — no link named "Level management".

- [ ] **Step 3: Rename in `admin-sidebar.tsx`** — line 21, in `ADMIN_NAV` (this array is replaced wholesale in Task 3, but rename here first so Task 1 is independently correct):

```tsx
  { label: 'Level management', href: '/admin/levels' },
```

- [ ] **Step 4: Rename in `admin/levels/page.tsx`** — metadata (line 10) and heading (line 71), and tighten the body copy so it reads as level config, not teacher HR:

```tsx
export const metadata = { title: 'Level management — CMT Portal admin' };
```
```tsx
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Admin · Bala Vihar</p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>Level management</h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 660, lineHeight: 1.55 }}>
          A level is a Bala Vihar class for a location + period. Level names and grade-bands differ by
          location, so the same grade maps to a different level at a different centre. Configure levels
          below, and assign the teachers who cover each one — the teacher capability takes effect on
          their next sign-in.
        </p>
```

- [ ] **Step 5: Rename the dashboard tile in `admin/page.tsx`** — lines 55-61:

```tsx
        <Tile
          href="/admin/levels"
          title="Level management"
          icon="check"
          sub="Configure Bala Vihar levels (classes) per location + period, set grade-bands, and assign the teachers who cover each one."
          tone="primary"
        />
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/admin/components/__tests__/admin-sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/app/admin/levels/page.tsx apps/portal/src/features/admin/components/admin-sidebar.tsx apps/portal/src/app/admin/page.tsx apps/portal/src/features/admin/components/__tests__/admin-sidebar.test.tsx
git commit -m "refactor(admin): rename 'Levels & teachers' → 'Level management'"
```

---

## Task 2: Restructure the admin dashboard into 4 grouped sections

**Files:**
- Modify: `apps/portal/src/app/admin/page.tsx` (the tile grid → grouped sections)
- Test: `apps/portal/src/app/admin/__tests__/page.test.tsx` (new)

**Section assignment (existing routes only — no new routes in Phase 1):**
- **People & access** — Family search (`/welcome`), Welcome-team grants (`/admin/welcome-team`)
- **Bala Vihar** — Programs (`/admin/programs`), Level management (`/admin/levels`), Class calendar (`/admin/calendar`), School year rollover (`/admin/school-year`), Volunteering skills (`/admin/volunteering-skills`), Seva (`/welcome/seva`)
- **Reports** — Reports (`/check-in/admin/reports`, legacy tone)
- **Legacy · door app** — Check-in dashboard (`/check-in/admin`), Guests (`/check-in/admin/guests`), Unpaid families (`/check-in/admin/unpaid`), Admin users (`/check-in/admin/users`), Donation periods (`/admin/donation-periods`)

- [ ] **Step 1: Write the failing structure test** — new file `apps/portal/src/app/admin/__tests__/page.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminPage from '../page';

describe('AdminPage dashboard', () => {
  it('renders the four section headings', () => {
    render(<AdminPage />);
    expect(screen.getByRole('heading', { name: /people & access/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /bala vihar/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^reports$/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /legacy/i })).toBeTruthy();
  });

  it('keeps every tile reachable via a link with an href', () => {
    render(<AdminPage />);
    for (const href of ['/welcome', '/admin/welcome-team', '/admin/programs', '/admin/levels', '/admin/calendar', '/admin/school-year', '/admin/volunteering-skills', '/check-in/admin/reports']) {
      const links = screen.getAllByRole('link');
      expect(links.some((l) => l.getAttribute('href') === href)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/admin/__tests__/page.test.tsx`
Expected: FAIL — no section headings.

- [ ] **Step 3: Restructure `admin/page.tsx`** — keep the existing `Tile` component as-is; replace the single flat `<div grid>` with a `Section` helper + a `GROUPS` data array. Implementation guidance (the designer subagent owns final visual polish; this is the structure to hit):

```tsx
// Group data drives the render. tone 'legacy' keeps the muted treatment + badge.
const GROUPS: Array<{
  heading: string;
  blurb?: string;
  tiles: Array<{ href: string; title: string; icon: keyof typeof SetuIcon; sub: string; tone: 'primary' | 'legacy' }>;
}> = [
  {
    heading: 'People & access',
    tiles: [
      { href: '/welcome', title: 'Family search', icon: 'search', tone: 'primary', sub: 'Look up any family by name, FID, legacy FID, email, or phone. Read-only family detail.' },
      { href: '/admin/welcome-team', title: 'Welcome-team grants', icon: 'people', tone: 'primary', sub: 'Grant + revoke welcome-team access for CMT volunteers helping families on Sunday.' },
    ],
  },
  {
    heading: 'Bala Vihar',
    tiles: [
      { href: '/admin/programs', title: 'Programs', icon: 'people', tone: 'primary', sub: 'Manage programs (Bala Vihar, Tabla, etc.), their offerings per term, eligibility, and capabilities.' },
      { href: '/admin/levels', title: 'Level management', icon: 'check', tone: 'primary', sub: 'Configure Bala Vihar levels per location + period, set grade-bands, and assign the teachers who cover each one.' },
      { href: '/admin/calendar', title: 'Class calendar', icon: 'calendar', tone: 'primary', sub: 'Publish the school-year Sunday schedule + weekly times. Families see it on their dashboard.' },
      { href: '/admin/school-year', title: 'School year rollover', icon: 'check', tone: 'primary', sub: 'Promote Bala Vihar families to the next school year — advance grades, re-assign levels, keep history.' },
      { href: '/admin/volunteering-skills', title: 'Volunteering skills', icon: 'check', tone: 'primary', sub: 'Manage the list of volunteering skills families choose from for adult members.' },
      { href: '/welcome/seva', title: 'Seva', icon: 'heart', tone: 'primary', sub: 'Manage seva opportunities and review volunteer signups.' },
    ],
  },
  {
    heading: 'Reports',
    tiles: [
      { href: '/check-in/admin/reports', title: 'Reports', icon: 'info', tone: 'legacy', sub: 'Legacy: attendance + engagement CSV exports. A unified Reports hub is coming.' },
    ],
  },
  {
    heading: 'Legacy · door app',
    blurb: 'Standalone check-in kiosk tools. Retiring after the door cutover.',
    tiles: [
      { href: '/check-in/admin', title: 'Check-in dashboard', icon: 'home', tone: 'legacy', sub: 'Live check-in counts and operational stats.' },
      { href: '/check-in/admin/guests', title: 'Guests', icon: 'people', tone: 'legacy', sub: 'Recent guest check-ins from the Sunday kiosk.' },
      { href: '/check-in/admin/unpaid', title: 'Unpaid families', icon: 'warn', tone: 'legacy', sub: 'Families whose dakshina is outstanding.' },
      { href: '/check-in/admin/users', title: 'Admin users', icon: 'shield', tone: 'legacy', sub: 'Add or remove other admins.' },
      { href: '/admin/donation-periods', title: 'Donation periods', icon: 'receipt', tone: 'legacy', sub: 'Redirects to Programs → Offerings. Kept for bookmarks.' },
    ],
  },
];

function Section({ heading, blurb, children }: { heading: string; blurb?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>{heading}</h2>
        {blurb && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{blurb}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {children}
      </div>
    </section>
  );
}
```

Render: keep the existing `<header>` (update the intro copy to mention "grouped by area"), then map `GROUPS` → `<Section>` wrapping `<Tile>`s. Keep the existing "About this surface" footer card. The page stays a synchronous server component.

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/admin/__tests__/page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Designer + mobile pass** (dispatched as a designer review after implementation — see execution notes): verify the grouped grid is visually balanced on desktop AND that on a 375px mobile viewport sections stack cleanly, headings are legible, tiles are full-width and tappable (≥44px), and `.csp` tokens resolve (admin layout already wraps in `CspRoot`). Fix any spacing/wrapping issues.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/app/admin/page.tsx apps/portal/src/app/admin/__tests__/page.test.tsx
git commit -m "refactor(admin): group admin dashboard into 4 labelled sections"
```

---

## Task 3: Group the desktop sidebar nav into the 4 sections

**Files:**
- Modify: `apps/portal/src/features/admin/components/admin-sidebar.tsx`
- Modify: `apps/portal/src/features/admin/components/__tests__/admin-sidebar.test.tsx`

- [ ] **Step 1: Write/adjust the failing tests** — in `admin-sidebar.test.tsx`:
  - Update the school-year expectation (it now appears in the nav). Replace the existing test `does not highlight Dashboard for /admin/school-year (no nav item)` with:

```tsx
  it('maps /admin/school-year → its nav item (now in the nav)', () => {
    expect(deriveAdminActive('/admin/school-year')).toBe('/admin/school-year');
  });
```
  - Add a group-header assertion:

```tsx
  it('renders the four nav section headers', () => {
    render(<AdminSidebar displayEmail="a@b.com" hasFamily={false} />);
    for (const h of [/people & access/i, /bala vihar/i, /^reports$/i, /legacy/i]) {
      expect(screen.getByText(h)).toBeTruthy();
    }
  });
```
  (Keep the existing tests for Dashboard / Family search / Seva hrefs and the Level management test from Task 1 — they still hold.)

- [ ] **Step 2: Run, verify the new/changed tests fail**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/admin/components/__tests__/admin-sidebar.test.tsx`
Expected: FAIL — no section headers; school-year still returns ''.

- [ ] **Step 3: Replace flat `ADMIN_NAV` with grouped sections.** Keep "Dashboard" (`/admin`) as a standalone top item above the groups. New data + render:

```tsx
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
```

  - Render a "Dashboard" link first (active when `active === '/admin'`), then map `NAV_GROUPS` → a group header `<div>` (uppercase muted, same style as the dashboard `Section` heading) followed by the group's item links. Reuse the existing per-item `<Link>` styling (active = `var(--accentSoft)` bg + `var(--accentDeep)` + `aria-current="page"`; legacy badge). Keep the top "Back to my family" / "Teacher" cross-links and the bottom user/sign-out card unchanged.

- [ ] **Step 4: Extend `deriveAdminActive`** — add mappings for the routes now in the nav (before the final `/admin` check):

```tsx
  if (pathname.startsWith('/admin/school-year')) return '/admin/school-year';
  if (pathname.startsWith('/admin/donation-periods')) return '/admin/donation-periods';
  if (pathname.startsWith('/check-in/admin/reports')) return '/check-in/admin/reports';
  if (pathname.startsWith('/check-in/admin/guests')) return '/check-in/admin/guests';
  if (pathname.startsWith('/check-in/admin/unpaid')) return '/check-in/admin/unpaid';
  if (pathname === '/check-in/admin') return '/check-in/admin';
```
  (Keep existing mappings; `/check-in/admin/users` already maps. Ensure the generic `/check-in/admin/` users mapping still precedes `/check-in/admin` exact.)

- [ ] **Step 5: Run the full sidebar test file, verify pass**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/admin/components/__tests__/admin-sidebar.test.tsx`
Expected: PASS (all, including the unchanged Dashboard/Family search/Seva tests).

- [ ] **Step 6: Designer + mobile pass** — confirm the grouped sidebar reads cleanly on desktop (header rhythm, active highlight still obvious), and that nothing about the change regresses the narrow-but-present sidebar. (Sidebar is desktop-only via `hidden md:flex` in the layout, so mobile is Task 4.)

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/features/admin/components/admin-sidebar.tsx apps/portal/src/features/admin/components/__tests__/admin-sidebar.test.tsx
git commit -m "refactor(admin): group desktop sidebar nav into 4 sections"
```

---

## Task 4: Align admin mobile nav + mobile-perfection check

**Files:**
- Modify: `apps/portal/src/features/admin/components/admin-mobile-nav.tsx`

The mobile bottom nav has 4 tabs (Home / Programs / Levels / Calendar) + a "More" sheet that already groups `MORE_THEMED` and `MORE_LEGACY`. Phase 1 work here is alignment + polish, not restructure.

- [ ] **Step 1: Update the "More" sheet to mirror the new grouping.** Reorganize `MORE_THEMED` / `MORE_LEGACY` so the sheet reads in the same People & access / Bala Vihar / Reports / Legacy order, with small uppercase group headers (reuse the existing "Legacy tools" header style). Keep all current hrefs. Suggested:

```tsx
// People & access + Bala Vihar extras not already in the bottom tabs:
const MORE_THEMED: { label: string; icon: keyof typeof SetuIcon; href: string }[] = [
  { label: 'Family search', icon: 'search', href: '/welcome' },
  { label: 'Welcome-team grants', icon: 'people', href: '/admin/welcome-team' },
  { label: 'School year rollover', icon: 'check', href: '/admin/school-year' },
  { label: 'Volunteering skills', icon: 'check', href: '/admin/volunteering-skills' },
  { label: 'Seva', icon: 'heart', href: '/welcome/seva' },
];
const MORE_LEGACY: { label: string; href: string }[] = [
  { label: 'Reports', href: '/check-in/admin/reports' },
  { label: 'Admin users', href: '/check-in/admin/users' },
  { label: 'Guests', href: '/check-in/admin/guests' },
  { label: 'Unpaid families', href: '/check-in/admin/unpaid' },
  { label: 'Check-in dashboard', href: '/check-in/admin' },
];
```
  (The bottom tab labelled "Levels" stays — it's a short tab label, not the page title; no rename needed there. Optionally relabel the tab "Levels" → keep, since space is tight.)

- [ ] **Step 2: Mobile-viewport verification (designer-owned).** On a 375×812 viewport, confirm: bottom nav doesn't overlap content (pages already pad for it), the More sheet scrolls, group headers are legible, every link is ≥44px tap height and dismisses the sheet, safe-area padding holds, `.csp` tokens resolve (the nav already sets `className="csp"`). Fix any overlap/contrast/tap-target issues.

- [ ] **Step 3: Typecheck + lint the touched files**

Run: `pnpm --filter @cmt/portal exec tsc --noEmit` (expect clean) and `pnpm --filter @cmt/portal lint` (expect clean for the touched files).

- [ ] **Step 4: Commit**

```bash
git add apps/portal/src/features/admin/components/admin-mobile-nav.tsx
git commit -m "refactor(admin): align admin mobile 'More' sheet with grouped IA"
```

---

## Final verification (after all tasks)

- [ ] Full suite green: `pnpm --filter @cmt/portal test` (or rely on the pre-push gate).
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean (pre-push runs these).
- [ ] **Mock-free walkthrough (note: requires admin OTP sign-in — operator step):** open `/admin` on desktop → see 4 grouped sections; open the sidebar → grouped nav with active highlight; shrink to mobile → bottom nav + grouped More sheet; open `/admin/levels` → title reads "Level management". Distinguish "tests pass" from "verified in UAT" in the summary.
- [ ] `git push` (pre-push gate enforces typecheck/lint/test/build).

## Notes for later phases (do NOT do in Phase 1)
- Phase 2 re-points "Welcome-team grants" → "Users & roles" (`/admin/users`), folds in legacy "Admin users", adds redirects.
- Phase 3 re-points "Family search" → "Roster" (`/welcome/roster`), adds redirect.
- Phase 4 re-points the Reports group → `/welcome/reports`.
