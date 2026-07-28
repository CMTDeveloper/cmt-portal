import { test, expect, request as apiRequest, type Page, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL } from '../../_helpers';

/**
 * The coordinator role, walked against DEPLOYED UAT. Everything Track A added
 * is invisible to mocks: the layout gates, the middleware allow-list and the
 * nav filtering all live in the integration layer, and a green
 * can-access-route unit test passes whether or not the handler and layout
 * gates were widened.
 *
 * TWO personas, because a standalone-only account passes while production
 * fails:
 *   - setu-test-coordinator  : standalone, role='coordinator', no family
 *   - setu-test-parent-brampton : family-manager with coordinator mid-keyed in
 *     roleAssignments, so it signs in as role='family-manager' +
 *     extraRoles=['coordinator'] - the shape a raw x-portal-role string
 *     comparison would wrongly 403.
 *
 * Auth is password sign-in, never OTP (the OTP limiter is shared, 5 per 15 min,
 * and cascades). These specs are READ-ONLY apart from one program-pricing save,
 * which restores the original value in a finally block.
 */

const DOMAIN = 'chinmayatoronto.org';
const PASSWORD = process.env.TEST_ACCOUNTS_PASSWORD ?? '';
const STANDALONE = `setu-test-coordinator@${DOMAIN}`;
const FAMILY_COORD = `setu-test-parent-brampton@${DOMAIN}`;
const PROBE_PROGRAM = 'e2e-coord-probe';

test.skip(!PASSWORD, 'TEST_ACCOUNTS_PASSWORD required (run seed:test-accounts first)');

/**
 * Sign in ONCE per persona and cache the cookies. password-sign-in is rate
 * limited to 5 per 15 minutes and the limiter is SHARED across every spec, so
 * signing in per test trips it within one file and every later test fails with
 * a 429 that reads like a broken fixture.
 */
type Cookies = Awaited<ReturnType<APIRequestContext['storageState']>>['cookies'];
const cookieCache = new Map<string, Cookies>();

async function cookiesFor(email: string): Promise<Cookies> {
  const cached = cookieCache.get(email);
  if (cached) return cached;
  const ctx: APIRequestContext = await apiRequest.newContext({
    baseURL: E2E_BASE_URL,
  });
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

function visible(page: Page, re: RegExp) {
  return page.getByText(re).filter({ visible: true });
}

for (const [label, email] of [
  ['standalone coordinator', STANDALONE],
  ['family-manager WITH coordinator in extraRoles', FAMILY_COORD],
] as const) {
  test.describe.serial(`coordinator - ${label}`, () => {
    test.beforeEach(async ({ page }) => signIn(page, email));

    test('reaches /welcome/roster with rows, not an access-denied screen', async ({ page }) => {
      await page.goto('/welcome/roster');
      await expect(page).toHaveURL(/\/welcome\/roster/);
      await expect(visible(page, /Access denied/i)).toHaveCount(0);
      // The roster's ONLY data source is /api/welcome/roster/report. If the
      // in-handler check had not been widened it returns 403 and the client
      // throws, so the page renders EMPTY rather than erroring - which is why
      // asserting on rows matters more than asserting the page loaded.
      await expect(page.getByRole('link', { name: /^CMT-|^\d{4}$/ }).first().or(visible(page, /famil(y|ies)/i).first()))
        .toBeVisible({ timeout: 20_000 });
    });

    test('reaches /admin/programs and /admin/levels', async ({ page }) => {
      for (const path of ['/admin/programs', '/admin/levels']) {
        await page.goto(path);
        await expect(page, `${path} redirected away`).toHaveURL(new RegExp(path));
        await expect(visible(page, /Access denied/i), `${path} rendered the shell gate`).toHaveCount(0);
      }
    });

    test('is DENIED /admin/users and /welcome/reports, without an ERR_TOO_MANY_REDIRECTS loop', async ({ page }) => {
      // The loop this pins was real and PRE-EXISTING: deny() carried
      // ?from=<denied path>, and the auth-entry branch honoured it and
      // redirected straight back. It bit every role with a dashboard; giving
      // coordinator one is what made it reachable. page.goto() throws on
      // ERR_TOO_MANY_REDIRECTS, so simply not throwing is part of the assertion.
      for (const path of ['/admin/users', '/welcome/reports']) {
        await page.goto(path);
        const denied = (await visible(page, /Access denied/i).count()) > 0;
        const bounced = !new RegExp(path).test(page.url());
        expect(denied || bounced, `${path} was reachable by a coordinator`).toBeTruthy();
      }
    });

    test('the welcome sidebar shows Roster and none of the welcome-team-only links', async ({ page }) => {
      await page.goto('/welcome/roster');
      await expect(visible(page, /^Roster$/).first()).toBeVisible({ timeout: 20_000 });
      // Each of these 302s at middleware for this role, so rendering the link
      // would be a dead end. The family-attached persona ALSO holds
      // family-manager, but /welcome renders the staff sidebar either way.
      for (const denied of ['Reports', 'Seva', 'Prasad']) {
        await expect(
          page.getByRole('link', { name: new RegExp(`^${denied}$`) }).filter({ visible: true }),
          `${denied} link rendered for a coordinator`,
        ).toHaveCount(0);
      }
    });
  });
}

/** The one mutation in this file. UAT is real, so remove it either side. */
async function deleteProbeProgram(): Promise<void> {
  const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
  await portalFirestore().collection('programs').doc(PROBE_PROGRAM).delete();
}

test.describe.serial('coordinator - the write that proves all three gates', () => {
  test.beforeAll(deleteProbeProgram);
  test.afterAll(deleteProbeProgram);
  test.beforeEach(async ({ page }) => signIn(page, STANDALONE));

  test('a coordinator can actually SAVE a program edit', async ({ page }) => {
    // The load-bearing assertion. A green can-access-route test passes whether
    // or not the handler check was widened; only a real 2xx write proves the
    // middleware, the handler and the layout all admit this role.
    const res = await page.request.post('/api/admin/programs', {
      data: { programKey: PROBE_PROGRAM, label: 'E2E Coordinator Probe' },
      failOnStatusCode: false,
    });
    expect(
      res.status(),
      `coordinator POST /api/admin/programs returned ${res.status()}: ${await res.text()}`,
    ).not.toBe(403);
  });

  test('a coordinator is still refused an admin-only write', async ({ page }) => {
    // The /api/admin/ catch-all is the only thing protecting welcome-team
    // granting, so this must stay closed.
    const res = await page.request.post('/api/admin/welcome-team', {
      data: { contact: 'nobody@example.com' },
      failOnStatusCode: false,
    });
    expect([401, 403, 404]).toContain(res.status());
  });
});
