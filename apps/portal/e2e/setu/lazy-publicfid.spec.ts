/**
 * Deployed-UAT E2E for lazy publicFid minting (Model Y2).
 *
 * Verifies the NOT-YET-MINTED state a family sees before its first enrollment:
 *   - GET /api/setu/dashboard returns family.publicFid === null (mobile contract);
 *   - the /family dashboard shows the "Assigned when you enroll" nudge, NOT a
 *     numeric Family ID and NEVER the internal CMT- id (nudge card + desktop
 *     sidebar).
 *
 * The MINTED state (a family that DOES have a publicFid) is already covered by
 * public-ids.spec.ts, and the mint transition (null -> id on first enrollment,
 * same id on a second-program enroll, no burn) by the real-UAT integration test
 * src/__tests__/e2e/enrollments.e2e.test.ts. This spec deliberately covers only
 * the pending render, which those cannot.
 *
 * Fixture: the dedicated pending family seeded by
 *   pnpm --filter @cmt/portal seed:e2e-pending-family
 * (a gate-complete family with NO publicFid + a password login). Set
 * E2E_PENDING_EMAIL / E2E_PENDING_PASSWORD to its creds (printed by the seed).
 *
 * Run (against the deployed UAT app):
 *   PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app \
 *     pnpm --filter @cmt/portal exec playwright test --project=setu lazy-publicfid
 */
import { test, expect, request, type APIRequestContext, type BrowserContext } from '@playwright/test';

const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY;
const PENDING_EMAIL = process.env.E2E_PENDING_EMAIL;
const PENDING_PASSWORD = process.env.E2E_PENDING_PASSWORD;
const hasPendingCreds = !!PENDING_EMAIL && !!PENDING_PASSWORD;

/** Exchange a Firebase custom token for an ID token (what the RN SDK does). */
async function customTokenToIdToken(apiKey: string, customToken: string): Promise<string> {
  const ctx = await request.newContext();
  const res = await ctx.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    { data: { token: customToken, returnSecureToken: true } },
  );
  expect(res.ok(), `custom-token exchange failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { idToken?: string };
  expect(body.idToken, 'no idToken in exchange response').toBeTruthy();
  await ctx.dispose();
  return body.idToken!;
}

async function mobileSignIn(baseURL: string, apiKey: string, email: string, password: string): Promise<string> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/setu/auth/password-sign-in?mode=mobile', { data: { email, password } });
  expect(res.ok(), `password-sign-in?mode=mobile failed for ${email}: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { customToken?: string };
  expect(body.customToken, 'mobile sign-in did not return a customToken').toBeTruthy();
  await ctx.dispose();
  return customTokenToIdToken(apiKey, body.customToken!);
}

/** A browser context signed in as the pending family via a cookie session. */
async function cookieContextForPending(baseURL: string): Promise<BrowserContext> {
  const api: APIRequestContext = await request.newContext({ baseURL });
  const res = await api.post('/api/setu/auth/password-sign-in', {
    data: { email: PENDING_EMAIL, password: PENDING_PASSWORD },
  });
  expect(res.ok(), `cookie sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const state = await api.storageState();
  await api.dispose();
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  return browser.newContext({ baseURL, storageState: state });
}

test.describe('lazy publicFid - the pending (not-yet-enrolled) family (deployed UAT)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!hasPendingCreds, 'E2E_PENDING_EMAIL / E2E_PENDING_PASSWORD required (seed:e2e-pending-family)');
  test.skip(!FIREBASE_API_KEY, 'NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY required for the token exchange');

  test('GET /api/setu/dashboard returns family.publicFid === null', async ({ baseURL }) => {
    const token = await mobileSignIn(baseURL!, FIREBASE_API_KEY!, PENDING_EMAIL!, PENDING_PASSWORD!);
    const ctx = await request.newContext({ baseURL: baseURL!, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
    const res = await ctx.get('/api/setu/dashboard');
    expect(res.status(), `dashboard GET: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as { family: { fid: string; publicFid: string | null } };
    expect(body.family.fid).toMatch(/^CMT-/); // internal join key still present
    expect(body.family.publicFid).toBeNull(); // not minted until first enrollment
    await ctx.dispose();
  });

  test('the /family dashboard shows the pending nudge and never the CMT- id', async ({ baseURL }) => {
    const context = await cookieContextForPending(baseURL!);
    try {
      const page = await context.newPage();
      await page.goto('/family');

      // The ID card renders the pending nudge, not a numeric Family ID.
      const pending = page.getByTestId('family-id-pending').filter({ visible: true }).first();
      await expect(pending).toBeVisible({ timeout: 20_000 });
      await expect(pending).toContainText(/assigned when you enroll/i);
      await expect(page.getByTestId('family-id-value').filter({ visible: true })).toHaveCount(0);

      // The internal CMT- id must not appear anywhere on this family-facing page
      // (neither the ID card nor the desktop sidebar subtitle).
      await expect(page.getByText(/CMT-/).filter({ visible: true })).toHaveCount(0);
    } finally {
      await context.browser()?.close();
    }
  });
});
