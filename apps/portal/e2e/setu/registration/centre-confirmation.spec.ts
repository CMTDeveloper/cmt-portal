import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, request, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { CENTRE_MANAGER_EMAIL, CENTRE_PASSWORD, hasCentreConfirmationCreds } from '../../_helpers';

/**
 * E2E for the unknown-centre prompt (spec 1.9c), verified against deployed UAT
 * (https://cmt-setu.vercel.app) backed by chinmaya-setu-uat Firestore.
 *
 * WHY THIS NEEDS A BROWSER. Every layer here is invisible to mocked unit tests:
 * the flag has to survive FamilyDocSchema, the hand-written field map in
 * get-family-by-fid (no spread - a field missed there is undefined forever), the
 * `use cache` boundary, and two redirect gates, before the form ever sees it. A
 * green unit suite proved none of that; an earlier revision of this feature was
 * inert in UAT with four passing tests.
 *
 * The fixture (scripts/seed-centre-confirmation-family.ts) is a RETURNING family:
 * three complete members and a complete home address, with the centre as the ONLY
 * gap. That is deliberate - it is the shape that used to loop forever, because it
 * satisfied /complete-profile's load short-circuit, hard-navigated to /family, and
 * was sent straight back. A fixture incomplete in any other way would be held on
 * the form for the wrong reason and prove nothing.
 *
 * SEQUENTIAL + MUTATING: test 2 confirms a centre and clears the flag, so the
 * suite re-seeds in beforeAll and runs serial. Auth is password sign-in (never
 * OTP), once, reused across contexts - the per-email limiter is 5/15min.
 */
test.describe('registration — unknown-centre confirmation', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !hasCentreConfirmationCreds,
    'E2E_CENTRE_PASSWORD / E2E_FAMILY_PASSWORD required (run seed:centre-confirmation-family first)',
  );

  // Empty jar so this manager's session never inherits the `setu` project's
  // storageState (a different family).
  const EMPTY_STATE = { cookies: [], origins: [] };
  let baseURL: string;
  let managerState: Awaited<ReturnType<APIRequestContext['storageState']>>;

  test.beforeAll(async ({ baseURL: bu }) => {
    baseURL = bu!;
    // Idempotent, UAT-only. Re-asserts locationNeedsConfirmation:true and
    // re-completes every member, so test 2 is repeatable after a prior run.
    execSync('pnpm --filter @cmt/portal seed:centre-confirmation-family', {
      cwd: resolve(process.cwd(), '..', '..'),
      stdio: 'pipe',
      timeout: 120_000,
    });

    const ctx = await request.newContext({ baseURL, storageState: EMPTY_STATE });
    try {
      const signIn = await ctx.post('/api/setu/auth/password-sign-in', {
        data: { email: CENTRE_MANAGER_EMAIL, password: CENTRE_PASSWORD },
      });
      expect(
        signIn.status(),
        'rate-limited: wait 15 minutes rather than re-running (shared 5/15min limiter)',
      ).not.toBe(429);
      expect(signIn.ok(), `manager sign-in failed: ${signIn.status()}`).toBeTruthy();
      // Sign-in itself succeeds and targets /family; the GATE is what diverts.
      expect((await signIn.json()).redirectTo).toBe('/family');
      managerState = await ctx.storageState();
    } finally {
      await ctx.dispose();
    }
  });

  // ── 1. The flag reaches the browser, and the family is held on the form ─────
  test('an otherwise-complete family with an unknown centre is held on /complete-profile', async ({ browser }) => {
    const ctx = await managerContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto('/family');
      await expect(page).toHaveURL(/\/complete-profile(\/|$|\?)/, { timeout: 30_000 });

      // The selector rendered, which proves the flag survived the schema, BOTH
      // hand-maps, `use cache`, and the gate.
      const centre = centreSelect(page);
      await expect(centre).toBeVisible({ timeout: 20_000 });

      // UNSELECTED. Seeding it from family.location would prefill the defaulted
      // 'Brampton' and let them Save without choosing - recording the migration's
      // guess as the family's answer, with a false audit trail.
      await expect(centre).toHaveValue('');

      // And it did NOT bounce: the loop this feature had to avoid would show up
      // as a URL oscillation rather than a stable completion screen.
      await page.waitForTimeout(1500);
      expect(page.url()).toContain('/complete-profile');
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── 2. Save is blocked until they pick, then it lands and sticks ────────────
  test('Save is blocked until a centre is picked, then reaches the dashboard', async ({ browser }) => {
    const ctx = await managerContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto('/complete-profile');
      const centre = centreSelect(page);
      await expect(centre).toBeVisible({ timeout: 30_000 });

      // Every member and the address are already complete, so the centre is the
      // ONLY thing that can be blocking Save here.
      const save = page.getByRole('button', { name: /Save and continue/i }).filter({ visible: true }).first();
      await save.click();
      await page.waitForTimeout(1000);
      expect(page.url()).toContain('/complete-profile'); // refused, still here

      await centre.selectOption('Scarborough');
      await save.click();

      await expect(page).toHaveURL(/\/family\/?($|\?)/, { timeout: 30_000 });
      expect(page.url()).not.toContain('/complete-profile');
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── 3. The flag actually cleared, server-side ──────────────────────────────
  test('the centre is persisted and the gate does not re-fire on reload', async ({ browser }) => {
    const ctx = await managerContext(browser);
    const page = await ctx.newPage();
    try {
      // A family updated moments ago can briefly read a stale `use cache` value
      // in the gate; a reload re-runs it on fresh data. Poll until it settles.
      await expect(async () => {
        await page.goto('/family');
        await page.waitForLoadState('networkidle');
        expect(page.url()).not.toContain('/complete-profile');
      }).toPass({ timeout: 30_000 });

      // Confirm at the source rather than inferring from the redirect: the
      // centre is the one they PICKED, not the defaulted Brampton, and the flag
      // is cleared.
      const api = await request.newContext({ baseURL, storageState: managerState });
      try {
        const res = await api.get('/api/setu/family');
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as {
          family: { location: string; locationNeedsConfirmation?: boolean | null };
        };
        expect(body.family.location).toBe('Scarborough');
        expect(body.family.locationNeedsConfirmation).not.toBe(true);
      } finally {
        await api.dispose();
      }
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── 4. The control: a family that is not being asked is left alone ─────────
  // If the gate or the Save predicate keyed on anything other than the literal
  // `true`, families that should never be asked would be diverted to a question
  // with no answer to give - so this negative is the important one.
  //
  // NOTE ON WHAT THIS COVERS: test 2 set the flag to `false`, so this asserts
  // the ANSWERED state, not the ABSENT one. The ~568 bulk-migrated families with
  // a real centre carry NO field at all. Absent is covered by unit tests
  // (needsCentreConfirmation + the gate suites) and implicitly by every other
  // deployed-UAT spec, whose families have no flag and reach /family normally.
  test('a family whose centre is already settled is not asked again', async ({ browser }) => {
    const ctx = await managerContext(browser);
    const page = await ctx.newPage();
    try {
      await expect(async () => {
        await page.goto('/family');
        await page.waitForLoadState('networkidle');
        expect(page.url()).not.toContain('/complete-profile');
      }).toPass({ timeout: 30_000 });

      await page.goto('/complete-profile');
      // Direct visit with nothing outstanding → the load short-circuit sends
      // them back to the dashboard instead of showing an unanswerable form.
      await expect(page).toHaveURL(/\/family\/?($|\?)/, { timeout: 30_000 });
      await expect(centreSelect(page)).toHaveCount(0);
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  function managerContext(browser: Browser) {
    return browser.newContext({ baseURL, storageState: managerState });
  }
});

/** The form renders mobile + desktop trees; target the one actually shown. */
function centreSelect(page: Page) {
  return page.getByLabel('Centre', { exact: true }).filter({ visible: true }).first();
}
