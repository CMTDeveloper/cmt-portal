import { test, expect, request as apiRequest, type Page, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL } from '../../_helpers';

/**
 * Two production reports from 2026-08-03, against DEPLOYED UAT.
 *
 * ── 1. /welcome/levels returned 500 on EVERY request ───────────────────────────
 * Next digest 399933007. `collectionGroup('enrollments').where('status','==',
 * 'active')` needs a COLLECTION_GROUP index for `status`, which exists in
 * neither project — so the page had been dead since it shipped and nobody knew,
 * because it had no end-to-end test. That is CLAUDE.md rule 7 exactly, and it is
 * why this file exists. Unit tests cannot catch it: fake-firestore is
 * index-blind, so the query passes there and FAILED_PRECONDITIONs live.
 *
 * ── 2. "Welcome team role permissions are not accurate" ────────────────────────
 * The role now reaches the roster and the visitors board and nothing else. Both
 * directions are asserted, and the second matters more: over-narrowing silently
 * breaks the one screen the front desk uses all day, and a 401 at middleware
 * looks like a broken fixture rather than a permissions bug.
 *
 * TWO welcome-team personas, because a standalone-only account passes while
 * production fails:
 *   - setu-test-sevak            : standalone, role='welcome-team', no family
 *   - setu-test-parent-volunteer : family-manager with welcome-team granted
 *     mid-keyed, so it signs in as role='family-manager' +
 *     extraRoles=['welcome-team'] — the shape production sees most often, and
 *     the one a bare `role === 'welcome-team'` comparison would wrongly deny.
 *
 * Auth is password sign-in, never OTP (the OTP limiter is shared, 5 per 15 min,
 * and cascades across specs). READ-ONLY throughout: no fixture is created or
 * mutated, so this is safe to re-run.
 *
 * Run (deployed UAT only):
 *     pnpm --filter @cmt/portal exec playwright test --project=setu welcome-scope
 */

const DOMAIN = 'chinmayatoronto.org';
const PASSWORD = process.env.TEST_ACCOUNTS_PASSWORD ?? '';
const ADMIN = `setu-test-admin@${DOMAIN}`;
const SEVAK = `setu-test-sevak@${DOMAIN}`;
const FAMILY_SEVAK = `setu-test-parent-volunteer@${DOMAIN}`;

test.skip(!PASSWORD, 'TEST_ACCOUNTS_PASSWORD required (run seed:test-accounts first)');

/** Sign in ONCE per persona: password-sign-in is limited to 5 per 15 minutes and
 *  the limiter is SHARED, so per-test sign-in trips it inside one file. */
type Cookies = Awaited<ReturnType<APIRequestContext['storageState']>>['cookies'];
const cookieCache = new Map<string, Cookies>();

async function cookiesFor(email: string): Promise<Cookies> {
  const cached = cookieCache.get(email);
  if (cached) return cached;
  const ctx: APIRequestContext = await apiRequest.newContext({ baseURL: E2E_BASE_URL });
  try {
    const res = await ctx.post('/api/setu/auth/password-sign-in', { data: { email, password: PASSWORD } });
    expect(res.ok(), `password-sign-in failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
    const { cookies } = await ctx.storageState();
    cookieCache.set(email, cookies);
    return cookies;
  } finally {
    await ctx.dispose();
  }
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().addCookies(await cookiesFor(email));
}

const visible = (page: Page, re: RegExp) => page.getByText(re).filter({ visible: true });

/** The Welcome error boundary — the exact screen Vaibhav photographed. */
const BOUNDARY = /Something went wrong in Welcome/i;

test.describe.serial('/welcome/levels renders instead of 500ing (digest 399933007)', () => {
  test.beforeEach(async ({ page }) => signIn(page, ADMIN));

  test('the levels index loads its data', async ({ page }) => {
    await page.goto('/welcome/levels');
    await expect(page).toHaveURL(/\/welcome\/levels/);

    // The error boundary is the regression. Assert its ABSENCE first and
    // explicitly: the heading below is server-rendered above the failing read,
    // so under PPR it can stream before the throw and a heading-only assertion
    // would pass against the broken build.
    await expect(
      visible(page, BOUNDARY),
      '/welcome/levels hit the Welcome error boundary — the collection-group query is unindexed again',
    ).toHaveCount(0);

    await expect(
      page.getByRole('heading', { level: 1, name: 'Levels & rosters' }).filter({ visible: true }),
    ).toBeVisible({ timeout: 30_000 });

    // Data, not just chrome: UAT has enabled levels at both centres, so a page
    // that rendered its shell and then swallowed the read would fail here.
    await expect(
      page.getByRole('heading', { level: 2, name: 'Brampton' }).filter({ visible: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: /View →/ }).first()).toBeVisible();
  });

  test('drilling into one level also loads', async ({ page }) => {
    await page.goto('/welcome/levels');
    await page.getByRole('link', { name: /View →/ }).first().click();
    await expect(page).toHaveURL(/\/welcome\/levels\/[^/]+$/);
    await expect(visible(page, BOUNDARY)).toHaveCount(0);
  });
});

for (const [label, email] of [
  ['standalone welcome-team', SEVAK],
  ['family-manager WITH welcome-team in extraRoles', FAMILY_SEVAK],
] as const) {
  test.describe.serial(`welcome-team scope — ${label}`, () => {
    test.beforeEach(async ({ page }) => signIn(page, email));

    // ── The half that matters most: did the narrowing break the day job? ──────
    test('still reaches the roster WITH ROWS', async ({ page }) => {
      await page.goto('/welcome/roster');
      await expect(page).toHaveURL(/\/welcome\/roster/);
      await expect(visible(page, /Access denied/i)).toHaveCount(0);
      // /api/welcome/roster/report is the roster's ONLY data source. If its
      // grant had been removed the client throws and the page renders EMPTY
      // rather than erroring — so rows, not "the page loaded", is the assertion.
      // Anchored on the href, not the link text: rows are LABELLED by family
      // name ("Abrol family") and carry publicFid, so a /CMT-/ name matcher
      // finds nothing and reads like a 403 when the data is fine.
      // `visible: true` because the roster renders its mobile AND desktop trees
      // both into the DOM - .first() otherwise picks the hidden mobile copy and
      // times out with "no rows" against a page that is showing 26 of them.
      await expect(
        page.locator('a[href^="/welcome/family/CMT-"]').filter({ visible: true }).first(),
        'the roster rendered but has no family rows — /api/welcome/roster/report is likely 403',
      ).toBeVisible({ timeout: 30_000 });
    });

    test('still reaches the visitors board', async ({ page }) => {
      await page.goto('/welcome/visitors');
      await expect(page).toHaveURL(/\/welcome\/visitors/);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Visitors' }).filter({ visible: true }),
      ).toBeVisible({ timeout: 30_000 });
    });

    test('still drills from a roster row into family detail', async ({ page }) => {
      await page.goto('/welcome/roster');
      const row = page.locator('a[href^="/welcome/family/CMT-"]').filter({ visible: true }).first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click();
      await expect(page).toHaveURL(/\/welcome\/family\/CMT-/);
      await expect(visible(page, /Access denied/i)).toHaveCount(0);
    });

    // ── The other half: everything the role was asked to give up. ─────────────
    // A denial redirects at middleware, so the assertion is on the URL, never on
    // a status code: under PPR a gate redirect streams AFTER the shell and curl
    // sees 200 for a page the user never gets.
    for (const path of ['/welcome/levels', '/welcome/seva', '/welcome/prasad', '/welcome/reports']) {
      test(`is refused ${path}`, async ({ page }) => {
        await page.goto(path);
        await expect(
          page,
          `${path} is still reachable by welcome-team`,
        ).not.toHaveURL(new RegExp(path.replace('/', '\\/') + '$'));
      });
    }

    test('the API surface it lost answers 401/403, not data', async () => {
      const cookies = await cookiesFor(email);
      const ctx = await apiRequest.newContext({
        baseURL: E2E_BASE_URL,
        extraHTTPHeaders: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
      });
      try {
        for (const path of [
          '/api/welcome/reports/enrollment',
          '/api/welcome/seva/opportunities',
          '/api/welcome/prasad/upcoming',
          '/api/admin/calendar?location=Brampton',
          '/api/admin/teachers/search?q=a',
        ]) {
          const res = await ctx.get(path);
          expect(
            [401, 403],
            `${path} answered ${res.status()} for welcome-team — it should be refused`,
          ).toContain(res.status());
        }
        // ...and the two it KEPT still answer.
        for (const path of ['/api/welcome/roster/report', '/api/setu/family/search?q=a']) {
          const res = await ctx.get(path);
          expect(res.status(), `${path} broke for welcome-team: ${await res.text()}`).toBe(200);
        }
      } finally {
        await ctx.dispose();
      }
    });

    test('the PHONE bottom nav offers only what the role can open', async ({ page }) => {
      // A phone viewport, deliberately. The bottom bar is `block md:hidden`, so
      // at Playwright's default 1280px it is display:none and every
      // "this link is absent" assertion below would pass for the wrong reason.
      // This is also the screen the report came from.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/welcome/roster');

      const nav = page.getByRole('navigation', { name: 'Welcome team' });
      await expect(nav, 'the bottom nav did not render on a phone viewport').toBeVisible({ timeout: 30_000 });

      // A tab pointing at a route the role cannot reach 302s on tap, which is a
      // worse experience than no tab at all.
      for (const gone of ['/welcome/levels', '/welcome/seva', '/welcome/prasad', '/welcome/reports']) {
        await expect(
          nav.locator(`a[href="${gone}"]`),
          `the nav still offers ${gone}, which this role cannot open`,
        ).toHaveCount(0);
      }
      await expect(nav.locator('a[href="/welcome/roster"]')).toHaveCount(1);
      await expect(nav.locator('a[href="/welcome/visitors"]')).toHaveCount(1);

      // The layout complaint that started this: nine items sharing 390px ran
      // their labels together. Assert legibility directly — no tab may overlap
      // its neighbour, and each must be wide enough to hold its label.
      const tabs = await nav.locator('a, button').all();
      const boxes = await Promise.all(tabs.map((t) => t.boundingBox()));
      const rows = new Map<number, Array<{ x: number; right: number }>>();
      for (const b of boxes) {
        expect(b, 'a nav tab has no box').not.toBeNull();
        expect(b!.width, 'a nav tab is too narrow to show its label').toBeGreaterThan(50);
        const row = rows.get(Math.round(b!.y)) ?? [];
        row.push({ x: b!.x, right: b!.x + b!.width });
        rows.set(Math.round(b!.y), row);
      }
      for (const [y, row] of rows) {
        const sorted = [...row].sort((a, b) => a.x - b.x);
        for (let i = 1; i < sorted.length; i++) {
          expect(
            sorted[i]!.x,
            `two bottom-nav tabs overlap on row y=${y} — labels will run together`,
          ).toBeGreaterThanOrEqual(sorted[i - 1]!.right - 1);
        }
      }
    });
  });
}

/**
 * Reported on preview 2026-08-03, one click apart: a parent granted welcome-team
 * saw no staff features in the family navigation, and once they reached the
 * staff area by URL there was no way back. Both were missing LINKS, not missing
 * permissions — the grant had landed correctly all along, which is precisely why
 * a permissions test could not have caught either one.
 *
 * Only the family-manager persona applies: setu-test-sevak is standalone and has
 * no family to cross-link to.
 */
test.describe.serial('a parent who is also welcome-team can move between both areas', () => {
  test.beforeEach(async ({ page }) => signIn(page, FAMILY_SEVAK));

  test('the family dashboard offers a way INTO the staff area', async ({ page }) => {
    await page.goto('/family');
    const link = page.getByRole('link', { name: /welcome team/i }).filter({ visible: true }).first();
    await expect(link, 'no route from /family into the welcome section').toBeVisible({ timeout: 30_000 });
    await link.click();
    await expect(page).toHaveURL(/\/welcome\/roster/);
  });

  test('and the staff area offers a way BACK', async ({ page }) => {
    await page.goto('/welcome/roster');
    const back = page.getByRole('link', { name: /my family/i }).filter({ visible: true }).first();
    await expect(back, 'stranded in /welcome with no route back to /family').toBeVisible({ timeout: 30_000 });
    await back.click();
    await expect(page).toHaveURL(/\/family/);
  });
});

test.describe.serial('admin keeps everything welcome-team gave up', () => {
  test.beforeEach(async ({ page }) => signIn(page, ADMIN));

  for (const path of ['/welcome/levels', '/welcome/seva', '/welcome/prasad', '/welcome/reports']) {
    test(`admin still opens ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(path.replace('/', '\\/')));
      await expect(visible(page, /Access denied/i)).toHaveCount(0);
      await expect(visible(page, BOUNDARY)).toHaveCount(0);
    });
  }

  test('and the admin phone nav still LISTS them, laid out legibly', async ({ page }) => {
    // The admin is the case the grid exists for: /admin links seva and reports
    // but NOT /welcome/levels or /welcome/prasad, so this bar is the only route
    // to those two — they must survive the declutter. Seven tabs plus sign-out
    // is also the density that was smearing the labels together.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/welcome/roster');

    const nav = page.getByRole('navigation', { name: 'Welcome team' });
    await expect(nav).toBeVisible({ timeout: 30_000 });
    for (const kept of ['/welcome/roster', '/welcome/visitors', '/welcome/levels', '/welcome/seva', '/welcome/prasad', '/welcome/reports', '/admin']) {
      await expect(
        nav.locator(`a[href="${kept}"]`),
        `${kept} vanished from the admin phone nav — for levels and prasad this bar is the only way in`,
      ).toHaveCount(1);
    }

    const boxes = await Promise.all((await nav.locator('a, button').all()).map((t) => t.boundingBox()));
    const rows = new Map<number, Array<{ x: number; right: number }>>();
    for (const b of boxes) {
      expect(b!.width, 'an admin nav tab is too narrow to show its label').toBeGreaterThan(50);
      const row = rows.get(Math.round(b!.y)) ?? [];
      row.push({ x: b!.x, right: b!.x + b!.width });
      rows.set(Math.round(b!.y), row);
    }
    // Eight cells cannot fit legibly on one 390px row; they must have wrapped.
    expect(rows.size, 'eight tabs are still crammed onto a single row').toBeGreaterThan(1);
    for (const [y, row] of rows) {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        expect(
          sorted[i]!.x,
          `two admin bottom-nav tabs overlap on row y=${y} — this is the reported bug`,
        ).toBeGreaterThanOrEqual(sorted[i - 1]!.right - 1);
      }
    }
  });
});

test.describe.serial('the roster page after the 2026-08-03 declutter', () => {
  test.beforeEach(async ({ page }) => signIn(page, ADMIN));

  test('no migration card and no pinned school-year banner', async ({ page }) => {
    await page.goto('/welcome/roster');
    await expect(page.getByRole('heading', { level: 1, name: 'Roster' }).filter({ visible: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      visible(page, /Migration status/i),
      'the migration card is back on the roster',
    ).toHaveCount(0);
    await expect(
      visible(page, /Operating in/i),
      'the school-year banner is back on the roster',
    ).toHaveCount(0);
  });

  test('but the year scope bar is still on the page that reads ?year=', async ({ page }) => {
    await page.goto('/welcome/reports');
    await expect(
      visible(page, /Operating in/i),
      'moving the scope bar out of the layout dropped it from /welcome/reports entirely',
    ).toBeVisible({ timeout: 30_000 });
  });
});
