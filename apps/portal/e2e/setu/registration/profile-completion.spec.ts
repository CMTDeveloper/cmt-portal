import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, request, type APIRequestContext, type Browser } from '@playwright/test';
import { PC_MANAGER_EMAIL, PC_PASSWORD, hasProfileCompletionCreds } from '../../_helpers';

/**
 * E2E for the post-sign-in profile-completion gate (design:
 * docs/superpowers/specs/2026-06-22-profile-completion-gate-and-registration-
 * fields-design.md), shipped 2026-06-22. Verified against deployed UAT
 * (https://cmt-setu.vercel.app), backed by chinmaya-setu-uat Firestore.
 *
 * The fixture (scripts/seed-profile-completion-family.ts) is a single-manager
 * family whose manager is deliberately GATE-INCOMPLETE — a real gender + email +
 * phone, but no foodAllergies and no volunteeringSkills (the two adult required
 * fields). Signing in succeeds, then the layout gate redirects to
 * /family/complete-profile until the family is complete.
 *
 * SEQUENTIAL + MUTATING: the second test completes the manager's profile, so the
 * suite RE-SEEDS in beforeAll to reset the manager to incomplete and stays in
 * serial mode (repeatable; no parallel workers racing the shared fixture / the
 * shared per-email OTP rate limit). Auth is password sign-in (never OTP).
 *
 * The gate redirect happens inside a Suspense boundary under cacheComponents, so
 * it surfaces as a CLIENT-side navigation — asserted via Playwright page URL, not
 * a raw HTTP status.
 */
test.describe('registration — profile-completion gate', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !hasProfileCompletionCreds,
    'E2E_PC_PASSWORD / E2E_FAMILY_PASSWORD required (run seed:profile-completion-family first)',
  );

  // Empty jar so the manager's session never inherits the `setu` project's
  // storageState (a different, admin family). One API sign-in, reused across the
  // three browser contexts — keeps us well under the per-email OTP rate limit.
  const EMPTY_STATE = { cookies: [], origins: [] };
  let baseURL: string;
  let managerState: Awaited<ReturnType<APIRequestContext['storageState']>>;

  test.beforeAll(async ({ baseURL: bu }) => {
    baseURL = bu!;
    // Re-seed (idempotent, UAT-only): resets the manager to the INCOMPLETE state
    // so the completing test is repeatable across runs.
    execSync('pnpm --filter @cmt/portal seed:profile-completion-family', {
      cwd: resolve(process.cwd(), '..', '..'),
      stdio: 'pipe',
      timeout: 120_000,
    });

    const ctx = await request.newContext({ baseURL, storageState: EMPTY_STATE });
    try {
      const signIn = await ctx.post('/api/setu/auth/password-sign-in', {
        data: { email: PC_MANAGER_EMAIL, password: PC_PASSWORD },
      });
      failOnRateLimit(signIn.status(), 'incomplete manager sign-in');
      expect(signIn.ok(), `manager sign-in failed: ${signIn.status()}`).toBeTruthy();
      const body = (await signIn.json()) as { redirectTo?: string; pendingApproval?: boolean };
      // Sign-in itself succeeds and targets /family — the GATE (not sign-in) is
      // what then bounces an incomplete family to the completion screen.
      expect(body.pendingApproval).toBeUndefined();
      expect(body.redirectTo).toBe('/family');
      managerState = await ctx.storageState();
    } finally {
      await ctx.dispose();
    }
  });

  // ── 1. An incomplete family is gated to /family/complete-profile ───────────
  test('signing in with an incomplete family redirects to /family/complete-profile', async ({ browser }) => {
    const ctx = await managerContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto('/family');
      // The layout gate redirects (client-side under cacheComponents streaming).
      await expect(page).toHaveURL(/\/family\/complete-profile/, { timeout: 30_000 });
      // The completion screen renders and names the two missing adult fields.
      await expect(visible(page, /A few details before you continue/i).first()).toBeVisible({ timeout: 20_000 });
      await expect(visible(page, /Food allergies/i).first()).toBeVisible();
      await expect(visible(page, /Volunteering skills/i).first()).toBeVisible();
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── 2. Completing the profile lands on the dashboard ───────────────────────
  test('filling the missing fields completes the profile and reaches the dashboard', async ({ browser }) => {
    const ctx = await managerContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto('/family/complete-profile');

      // foodAllergies → "No known allergies" (writes the 'None' sentinel). Use
      // click(), not check(): satisfying the field immediately removes it from
      // the card (the form shows only still-missing fields), so check()'s
      // post-click "is it checked?" assertion would race the unmount.
      const noAllergies = page.getByRole('checkbox', { name: /No known allergies/i }).filter({ visible: true });
      await expect(noAllergies.first()).toBeVisible({ timeout: 20_000 });
      await noAllergies.first().click();

      // volunteeringSkills → toggle the first available skill chip.
      const skillsGroup = page.getByRole('group', { name: 'Volunteering skills' }).filter({ visible: true });
      await expect(skillsGroup.first()).toBeVisible({ timeout: 20_000 });
      await skillsGroup.first().getByRole('button').first().click();

      // Now complete → Save enables → submit → the gate is satisfied → dashboard.
      const save = page.getByRole('button', { name: /Save and continue/i }).filter({ visible: true });
      await expect(save.first()).toBeEnabled({ timeout: 10_000 });
      await save.first().click();

      await expect(page).toHaveURL(/\/family\/?($|\?)/, { timeout: 30_000 });
      // Sanity: we are NOT back on the completion screen.
      expect(page.url()).not.toContain('/complete-profile');
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── 3. A now-complete family goes straight to the dashboard ────────────────
  test('a complete family is no longer gated (straight to /family)', async ({ browser }) => {
    // Test 2 just completed the manager; signing in again must NOT redirect.
    const ctx = await managerContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto('/family');
      // Give the client a beat to perform any gate redirect, then assert it did not.
      await page.waitForLoadState('networkidle');
      expect(page.url()).not.toContain('/complete-profile');
      await expect(page).toHaveURL(/\/family\/?($|\?)/, { timeout: 20_000 });
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  function managerContext(browser: Browser) {
    return browser.newContext({ baseURL, storageState: managerState });
  }
});

/** The completion screen renders mobile + desktop blocks; pick the visible one. */
function visible(page: import('@playwright/test').Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true });
}

/**
 * password-sign-in shares the per-email OTP rate limit (5 / 15 min). A 429 here
 * is shared-limiter NOISE (a re-run inside the window or a concurrent manual
 * sign-in), NOT a product bug — surface it as an explicit, actionable failure.
 */
function failOnRateLimit(status: number, label: string): void {
  if (status === 429) {
    throw new Error(
      `${label} hit the shared OTP rate limit (429). This is environmental, not a product bug — ` +
        `wait ~15 min for the per-email window to reset, then re-run.`,
    );
  }
}
