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
 * fields). Signing in succeeds, then the layout gate redirects to the top-level
 * /complete-profile route until the family is complete.
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

  // ── 1. An incomplete family is gated to /complete-profile ──────────────────
  test('signing in with an incomplete family redirects to /complete-profile', async ({ browser }) => {
    const ctx = await managerContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto('/family');
      // The layout gate redirects (client-side under cacheComponents streaming)
      // to the TOP-LEVEL /complete-profile route (outside /family — that's what
      // stops the redirect loop on soft navigation).
      await expect(page).toHaveURL(/\/complete-profile(\/|$|\?)/, { timeout: 30_000 });
      // The completion screen renders and names the two missing adult fields.
      await expect(visible(page, /A few details before you continue/i).first()).toBeVisible({ timeout: 20_000 });
      await expect(visible(page, /Food allergies/i).first()).toBeVisible();
      await expect(visible(page, /Volunteering skills/i).first()).toBeVisible();
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── 2. Completing the WHOLE family (manager scope) lands on the dashboard ───
  test('completing every member (manager + adult + child) reaches the dashboard', async ({ browser }) => {
    const ctx = await managerContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto('/complete-profile');

      // A MANAGER must complete the whole family — manager + 2nd adult + child.
      // Fill the first still-visible member card until none remain (order-robust;
      // each satisfied member drops out of the form). This exercises the N>1
      // manager scope that stranded the real 3-person family on "Saving…".
      await completeAllVisibleMembers(page);

      // Now everything is complete → Save enables → submit → HARD-navigates to
      // /family. The whole point of the fix: this must NOT loop back to
      // /complete-profile and strand on "Saving…".
      const save = page.getByRole('button', { name: /Save and continue/i }).filter({ visible: true });
      await expect(save.first()).toBeEnabled({ timeout: 10_000 });
      await save.first().click();

      await expect(page).toHaveURL(/\/family\/?($|\?)/, { timeout: 30_000 });
      // Sanity: we landed on the dashboard, NOT stuck back on the completion screen.
      expect(page.url()).not.toContain('/complete-profile');
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── 3. A now-complete family goes straight to the dashboard ────────────────
  test('a complete family is no longer gated (straight to /family)', async ({ browser }) => {
    // Test 2 just completed the whole family; signing in again must NOT redirect.
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
 * Complete every still-incomplete member by filling whatever the first VISIBLE
 * member card asks for (allergies, skills, birth month/year), then waiting for
 * that card to drop out, repeating until none remain. Order-robust: it doesn't
 * assume which member (adult vs child) renders first, and each card only shows
 * the fields it's still missing. The form renders mobile + desktop trees; the
 * `:visible` filter targets the one the viewport actually shows.
 */
async function completeAllVisibleMembers(page: import('@playwright/test').Page): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const cards = page.locator('[data-testid^="member-card-"]:visible');
    if ((await cards.count()) === 0) break;
    const card = cards.first();
    const tid = await card.getAttribute('data-testid');

    // foodAllergies → "No known allergies" (click, not check — the field unmounts
    // the moment it's satisfied, which would race check()'s post-click assertion).
    const noAllergies = card.getByRole('checkbox', { name: /No known allergies/i });
    if (await noAllergies.count()) await noAllergies.first().click();

    // volunteeringSkills (adults) → toggle the first available skill chip.
    const skills = card.getByRole('group', { name: 'Volunteering skills' });
    if (await skills.count()) await skills.first().getByRole('button').first().click();

    // birthMonthYear (child) → pick the first real month + year option (index 0
    // is the disabled placeholder). Both are required, so set both.
    const month = card.getByRole('combobox', { name: /Birth month/i });
    if (await month.count()) {
      await month.first().selectOption({ index: 1 });
      await card.getByRole('combobox', { name: /Birth year/i }).first().selectOption({ index: 1 });
    }

    // Wait for THIS member to drop out (fully satisfied) before the next card.
    // Fail fast with the card's own "still needs …" text if it doesn't clear —
    // the filler only handles allergies/skills/birthMonthYear, so a future seed
    // that leaves gender/schoolGrade/email/phone blank would otherwise hang for
    // 10s and fail with a cryptic timeout.
    if (tid) {
      const stillVisible = page.locator(`[data-testid="${tid}"]:visible`);
      try {
        await expect(stillVisible).toHaveCount(0, { timeout: 10_000 });
      } catch {
        const text = (await stillVisible.first().innerText().catch(() => '')) || '(card text unavailable)';
        throw new Error(
          `completeAllVisibleMembers: card ${tid} did not complete after filling all known field ` +
            `types — it still needs a field this helper does not handle. Card text: ${text}`,
        );
      }
    }
  }
  // Every member satisfied → no cards left; the "all set" note is showing.
  await expect(page.locator('[data-testid^="member-card-"]:visible')).toHaveCount(0, { timeout: 10_000 });
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
