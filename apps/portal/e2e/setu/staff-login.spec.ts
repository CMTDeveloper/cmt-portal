/**
 * Deployed-UAT E2E for the Kiosk Staff Login slice (Tasks 1-6).
 *
 * ── What it proves (against the DEPLOYED UAT app, the system-under-test) ────────
 *   (a) The kiosk PAGE is gated - an UNAUTHENTICATED GET /check-in is redirected
 *       by middleware (307) to /check-in/staff-sign-in and the friendly
 *       "Staff sign-in" page renders.
 *   (d) The legacy kiosk APIs are gated - an UNAUTHENTICATED request to
 *       /api/check-in/lookup and /api/check-in/families/1075 each 401 from the
 *       middleware (it gates BEFORE method, so even a GET on a POST route 401s).
 *   (b)+(c) The friendly sevak login works AND authorizes a kiosk API - POST
 *       /api/setu/auth/kiosk-sign-in with `sevak` + KIOSK_ACCOUNT_PASSWORD returns
 *       200 { redirectTo: '/check-in' } and sets a __session cookie; reusing that
 *       authed context, a kiosk API (GET /api/check-in/setu/lookup) is NOT 401
 *       (authorized - a 404 for a missing family still proves authorization).
 *   (e) The session-expired banner - /check-in/staff-sign-in?error=session-expired
 *       shows "Your session expired. Please sign in again." (Tasks 4/5 make a
 *       mid-use 401 land here so expiry is unmistakable).
 *
 * ── READ-ONLY / NON-MUTATING ────────────────────────────────────────────────────
 * This spec only signs in and does lookups - it never checks anyone in or writes
 * any data. So there is NOTHING to clean up (no afterAll teardown needed).
 *
 * ── Preconditions before this can go green (owner-supplied, out of band) ─────────
 *   1. The branch DEPLOYED to UAT (https://cmt-setu.vercel.app) with the kiosk
 *      feature flag ON (NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK=true) so the staff-sign-in
 *      page renders instead of 404ing.
 *   2. The generic kiosk account seeded on UAT:
 *        pnpm --filter @cmt/portal seed:kiosk-account
 *      with KIOSK_ACCOUNT_PASSWORD set in .env.local (the sevak password) AND
 *      KIOSK_ACCOUNT_EMAIL set in the DEPLOYED Vercel env (the route maps the
 *      `sevak` username to that email - if it is unset the route returns 500
 *      `server-misconfigured` and the sevak-login test fails with that text).
 *   3. .env.local carries KIOSK_ACCOUNT_PASSWORD - playwright.config.ts loads
 *      .env.local into process.env; absent creds → the sevak-login test self-skips.
 *
 * Run (against deployed UAT only - never prod), AFTER the owner approves + deploys:
 *   PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app \
 *     pnpm --filter @cmt/portal exec playwright test --project=setu staff-login
 *
 * Note the shared 5/15min sign-in limiter (password-sign-in / kiosk-sign-in share
 * the OTP rate-limiter keyed on the kiosk email): if the sevak-login test 429s,
 * clear it with the seed's `clear:otp-rate-limit` on the kiosk email and re-run.
 */
import { test, expect, request } from '@playwright/test';

// Owner-supplied credential, read in-spec (mirroring kiosk-auto-enroll.spec.ts).
// Only the password is needed here - the route maps the `sevak` username to the
// kiosk email server-side (KIOSK_ACCOUNT_EMAIL in the deployed Vercel env).
const KIOSK_PASSWORD = process.env.KIOSK_ACCOUNT_PASSWORD;
const hasKioskCreds = Boolean(KIOSK_PASSWORD);

// Fresh contexts need an explicit baseURL (request.newContext does not inherit the
// project's `use.baseURL`). Same derivation as playwright.config.ts's default.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

test.describe('Kiosk staff login (deployed UAT)', () => {
  // (a) The kiosk PAGE is gated: an unauthenticated visit to /check-in is
  // redirected to the friendly staff-sign-in page. A FRESH context (empty
  // storageState) is required - the `setu` project applies the admin/family
  // storageState by DEFAULT, which would otherwise authenticate the page.
  test('unauthenticated /check-in redirects to the staff sign-in page', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await ctx.newPage();
      await page.goto('/check-in');
      // Middleware issues a 307 to /check-in/staff-sign-in (with a ?from= param).
      expect(page.url(), `expected redirect to staff-sign-in, landed on ${page.url()}`).toContain(
        '/check-in/staff-sign-in',
      );
      await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  // (d) The legacy kiosk APIs are gated. Middleware `canAccessRoute` gates these to
  // the kiosk/admin role and runs BEFORE method dispatch, so an unauthenticated GET
  // on the POST-only lookup route still 401s from the middleware (that is exactly
  // what we assert - the route is NOT public). A fresh empty-storage context is
  // required so the setu project's default session does not authenticate it.
  test('unauthenticated legacy kiosk APIs return 401', async () => {
    const anon = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const lookup = await anon.get('/api/check-in/lookup');
      expect(lookup.status(), `unauth /api/check-in/lookup should 401, got ${lookup.status()}`).toBe(401);

      const family = await anon.get('/api/check-in/families/1075');
      expect(family.status(), `unauth /api/check-in/families/1075 should 401, got ${family.status()}`).toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  // (b)+(c) The friendly sevak login works and authorizes a kiosk API. This one
  // needs the seeded kiosk account + password, so it self-skips locally.
  test('sevak sign-in mints a kiosk session and authorizes a kiosk API', async () => {
    test.skip(!hasKioskCreds, 'KIOSK_ACCOUNT_PASSWORD required (run seed:kiosk-account on UAT)');

    const ctx = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      // (b) Sign in with the friendly `sevak` username + the shared password.
      const res = await ctx.post('/api/setu/auth/kiosk-sign-in', {
        data: { username: 'sevak', password: KIOSK_PASSWORD },
      });
      // A 500 `server-misconfigured` here means KIOSK_ACCOUNT_EMAIL is not set in
      // the DEPLOYED Vercel env - surface the body so that is unmistakable.
      expect(
        res.status(),
        `kiosk-sign-in expected 200, got ${res.status()}: ${await res.text()} (500 server-misconfigured ⇒ KIOSK_ACCOUNT_EMAIL is not set in the deployed Vercel env; 401 ⇒ wrong KIOSK_ACCOUNT_PASSWORD or account not seeded)`,
      ).toBe(200);
      expect((await res.json()).redirectTo).toBe('/check-in');

      // The session cookie is now in the context's jar.
      const cookies = (await ctx.storageState()).cookies;
      expect(
        cookies.some((c) => c.name === '__session'),
        'kiosk-sign-in should set a __session cookie',
      ).toBeTruthy();

      // (c) Reusing that SAME authed context, a kiosk API is reachable (authorized).
      // A 404 for a missing family is fine - the point is it is NOT 401, which
      // proves the kiosk session authorizes the route.
      const lookup = await ctx.get('/api/check-in/setu/lookup?id=1');
      expect(
        lookup.status(),
        `authed kiosk lookup should be authorized (not 401), got ${lookup.status()}: ${await lookup.text()}`,
      ).not.toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  // (e) The session-expired banner. When a mid-use 401 bounces the sevak back to the
  // sign-in page (Tasks 4/5), it lands with ?error=session-expired and this friendly
  // banner explains why. A fresh context is not strictly required (the page is
  // public), but we use one for parity + to avoid any default session redirect.
  test('the session-expired banner renders on the staff sign-in page', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await ctx.newPage();
      await page.goto('/check-in/staff-sign-in?error=session-expired');
      await expect(page.getByText('Your session expired. Please sign in again.')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
