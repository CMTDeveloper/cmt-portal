import { test, expect } from '@playwright/test';
import { E2E_BASE_URL } from '../_helpers';

/**
 * ── WHY THIS SPEC EXISTS ────────────────────────────────────────────────────
 *
 * On 2026-08-04 the owner reported that on Safari on a real iPhone, tapping
 * anything in the family portal did nothing - "Manage family", the bottom nav,
 * "Add a child to enroll" - while "in browser responsive view everything works".
 *
 * It was not slowness. The server answers the RSC request for the destination
 * in ~170ms. What fails is the client-side NAVIGATION: React throws while
 * applying the payload, the router transition dies, and the URL never changes.
 * The page you are standing on stays fully interactive - local state, sheets,
 * toggles all work - which is exactly why it reads as "the app froze" rather
 * than "the page is broken", and why it went undiagnosed for a month as
 * issue #62 (in Sentry since 2026-07-10).
 *
 * Measured against a local production build with the pre-fix layout:
 *     WebKit    "Manage family"  DEAD >15s   3/3 runs
 *     WebKit    bottom nav Home  DEAD >15s   3/3 runs
 *     Chromium  bottom nav Home  DEAD >15s   2/3 runs   <- NOT Safari-only
 *
 * ── WHAT NOT TO ASSERT, AND WHY ─────────────────────────────────────────────
 *
 * Three plausible checks all PASS while this bug is live. Do not "improve" this
 * spec into any of them:
 *
 *   1. Page looks right / heading is visible. Server-rendered HTML is perfect.
 *   2. Counting DOM nodes that lack a `__reactFiber` key. This measures
 *      hydration PROGRESS, not failure - Chromium legitimately shows 636/720
 *      unclaimed at 0.5s and resolves by 2s - and a page sitting at "93%
 *      orphaned" still handled taps fine. Two confident conclusions were drawn
 *      from that number and both were wrong.
 *   3. Watching for React error #418/#419 in the console. They fire in passing
 *      runs too. Not a discriminator.
 *
 * The only check that separates a working portal from a frozen one is whether
 * a tap on a link actually takes you there. So that is what this asserts, on
 * BOTH engines, on the two hops a family uses most.
 *
 * Cheap by construction: page loads and clicks, no mutations.
 */

const HOPS = [
  { name: 'dashboard -> "Manage family"', from: '/family', link: /manage family/i, to: /\/family\/members/ },
  { name: 'members -> "Home" (bottom nav)', from: '/family/members', link: /^home$/i, to: /\/family$/ },
] as const;

for (const hop of HOPS) {
  test(`navigation completes: ${hop.name}`, async ({ page }) => {
    await page.goto(`${E2E_BASE_URL}${hop.from}`, { waitUntil: 'load', timeout: 60_000 });
    expect(page.url(), 'session expired - reseed e2e/.auth/family.json').not.toContain('/sign-in');

    // Let streamed Suspense content settle, so this measures a real navigation
    // rather than a click fired mid-hydration.
    await page.waitForTimeout(5_000);

    const link = page.getByRole('link', { name: hop.link }).first();
    await expect(link, `no "${String(hop.link)}" link on ${hop.from}`).toBeVisible();
    await link.click();

    // 15s is not a performance budget - the healthy number is ~280ms on both
    // engines. It is deliberately generous so that a failure means "the
    // navigation never happened", never "the CI runner was busy".
    await expect(
      page,
      `tapping this link did not navigate. The page still renders and still responds to local `
        + `state, so a family experiences this as the whole app freezing. See issue #62.`,
    ).toHaveURL(hop.to, { timeout: 15_000 });
  });
}

test('a second navigation still works (the failure is sticky)', async ({ page }) => {
  // When the router transition dies, the tab does not recover: a subsequent
  // hard navigation timed out at 90s during diagnosis. So one successful hop is
  // not enough - walk two, which is what any real family does.
  await page.goto(`${E2E_BASE_URL}/family`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForTimeout(5_000);

  await page.getByRole('link', { name: /manage family/i }).first().click();
  await expect(page).toHaveURL(/\/family\/members/, { timeout: 15_000 });

  await page.getByRole('link', { name: /^home$/i }).first().click();
  await expect(page).toHaveURL(/\/family$/, { timeout: 15_000 });
});
