/**
 * A REQUEST BUDGET for the family dashboard.
 *
 * ── Why this spec exists ────────────────────────────────────────────────────
 * A real family reported production as "extremely slow, hangs from once click
 * to another" on 2026-08-03. Measured here against deployed preview, ONE load
 * of /family was issuing **37 requests** to our own origin:
 *
 *   - 31 prefetches, the same route up to SIX times (/welcome/roster x6,
 *     /family/settings/security x6, /family/enroll/bala-vihar x5)
 *   - FOUR identical GET /api/setu/join-request, slowest finishing 930ms in
 *
 * After the fix: **2**.
 *
 * ── Why it asserts COUNTS and not appearance ────────────────────────────────
 * Every one of those 37 requests succeeded, and the page looked perfect. No
 * rendering assertion, at any level of detail, could have caught this - which
 * is exactly how it reached production and stayed there. The only thing that
 * distinguishes the fixed page from the broken one is how many times it asks
 * the server. So that is what this measures.
 *
 * ── Reading a failure ───────────────────────────────────────────────────────
 * A failure here is not cosmetic. It means every family is paying N times the
 * server work for one page view, on a phone, on cellular. The usual cause is a
 * new `<Link>` without `prefetch={false}` (every route under /family is fully
 * dynamic, so its prefetch can NEVER be reused - see NAV_PREFETCH in
 * desktop-sidebar.tsx) or a client component fetching on mount for data the
 * server could have passed down.
 */
import { test, expect, type Page } from '@playwright/test';
import { TEST_ACCOUNT_EMAILS, TEST_ACCOUNTS_PASSWORD, hasTestAccounts, E2E_BASE_URL } from '../_helpers';

/**
 * Headroom over the measured 2 (the document plus its CORS preflight), so an
 * incidental extra request does not fail the build - while still failing long
 * before anything approaches the 37 that prompted this.
 */
const BUDGET = 8;

interface Seen {
  path: string;
  prefetch: boolean;
}

/** Same-origin document/data traffic only. Static assets are not the question. */
function watch(page: Page, origin: string): Seen[] {
  const seen: Seen[] = [];
  page.on('requestfinished', (req) => {
    const url = new URL(req.url());
    if (url.origin !== origin) return;
    if (url.pathname.startsWith('/_next/static')) return;
    if (/\.(js|css|woff2?|png|svg|ico|jpg|jpeg|webp|map)$/.test(url.pathname)) return;
    seen.push({ path: url.pathname, prefetch: !!req.headers()['next-router-prefetch'] });
  });
  return seen;
}

function duplicates(seen: Seen[]): string[] {
  const byPath = new Map<string, number>();
  for (const s of seen) byPath.set(s.path, (byPath.get(s.path) ?? 0) + 1);
  return [...byPath.entries()].filter(([, n]) => n > 1).map(([p, n]) => `${p} x${n}`);
}

test.describe('family dashboard request budget', () => {
  test.skip(!hasTestAccounts, 'TEST_ACCOUNTS_PASSWORD required (run seed:test-accounts first)');
  test.setTimeout(120_000);

  test('one /family navigation stays within budget and repeats no route', async ({ page }) => {
    const origin = new URL(E2E_BASE_URL).origin;

    const res = await page.request.post('/api/setu/auth/password-sign-in', {
      data: { email: TEST_ACCOUNT_EMAILS.parentBrampton, password: TEST_ACCOUNTS_PASSWORD },
    });
    expect(res.ok(), `sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();

    // A phone, because that is who reported this.
    await page.setViewportSize({ width: 390, height: 844 });

    const seen = watch(page, origin);
    await page.goto('/family', { waitUntil: 'load' });

    // 🔴 If this is /complete-profile the fixture never reached the dashboard
    // and every count below is measuring the wrong page - which is precisely
    // the state the seed fix of 2026-08-03 corrected. Assert it explicitly
    // rather than silently budgeting a redirect.
    expect(
      new URL(page.url()).pathname,
      'fixture must land on the dashboard - re-run `pnpm --filter @cmt/portal seed:test-accounts`',
    ).toBe('/family');

    // Let any prefetch/mount effect fire. Without this settle the assertion
    // would pass on a page that goes on to issue thirty more requests.
    await page.waitForTimeout(4000);

    expect(
      duplicates(seen),
      'no route should be requested twice for one page view; a repeat means a ' +
        'prefetch that can never be reused (dynamic route, staleTime 0) or a ' +
        'component fetching on mount in both layout trees',
    ).toEqual([]);

    expect(
      seen.length,
      `request budget exceeded. Saw:\n${seen.map((s) => `  ${s.path}${s.prefetch ? ' (prefetch)' : ''}`).join('\n')}`,
    ).toBeLessThanOrEqual(BUDGET);
  });

  /**
   * The join-request panel specifically. It is rendered TWICE by /family (a
   * compact mobile copy and a desktop one) and used to fetch its own list on
   * mount from each, which is where four of the original 37 came from.
   *
   * Called out separately from the budget above because the budget would still
   * pass if this regressed while something else got cheaper, and because the
   * fix (pass the server's read down as a prop) is easy to undo by adding an
   * innocent-looking `useEffect`.
   */
  test('the dashboard makes no client call for join requests', async ({ page }) => {
    const origin = new URL(E2E_BASE_URL).origin;

    const res = await page.request.post('/api/setu/auth/password-sign-in', {
      data: { email: TEST_ACCOUNT_EMAILS.parentBrampton, password: TEST_ACCOUNTS_PASSWORD },
    });
    expect(res.ok(), `sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();

    const seen = watch(page, origin);
    await page.goto('/family', { waitUntil: 'load' });
    expect(new URL(page.url()).pathname).toBe('/family');
    await page.waitForTimeout(4000);

    expect(
      seen.filter((s) => s.path === '/api/setu/join-request').length,
      'the server passes the list to PendingJoinRequestsPanel as initialRequests; ' +
        'a call here means a mount effect came back',
    ).toBe(0);
  });
});

/**
 * The staff side, which the first pass MISSED.
 *
 * `/welcome/*` renders `AdminSidebarLive` for an ADMIN viewer and
 * `DesktopSidebarLive` for everyone else (app/welcome/layout.tsx). Only the
 * latter had been fixed, so admins - who use the roster daily - kept firing a
 * prefetch for all 16 admin nav entries on every page. Found by a Codex review
 * of a956c7d; this test is here so the two sidebars cannot drift apart again.
 */
test.describe('welcome roster request budget (admin sidebar)', () => {
  test.skip(!hasTestAccounts, 'TEST_ACCOUNTS_PASSWORD required (run seed:test-accounts first)');
  test.setTimeout(120_000);

  test('one /welcome/roster navigation as ADMIN stays within budget', async ({ page }) => {
    const origin = new URL(E2E_BASE_URL).origin;

    const res = await page.request.post('/api/setu/auth/password-sign-in', {
      data: { email: TEST_ACCOUNT_EMAILS.admin, password: TEST_ACCOUNTS_PASSWORD },
    });
    expect(res.ok(), `admin sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();

    const seen = watch(page, origin);
    await page.goto('/welcome/roster', { waitUntil: 'load' });

    // A redirect here means the admin grant is not what this test assumes, and
    // the counts below would be measuring /sign-in.
    expect(new URL(page.url()).pathname, 'admin must reach the roster').toBe('/welcome/roster');
    await page.waitForTimeout(4000);

    expect(
      duplicates(seen),
      'no route should be requested twice for one page view',
    ).toEqual([]);

    expect(
      seen.length,
      `request budget exceeded. Saw:\n${seen.map((s) => `  ${s.path}${s.prefetch ? ' (prefetch)' : ''}`).join('\n')}`,
    ).toBeLessThanOrEqual(BUDGET);
  });
});
