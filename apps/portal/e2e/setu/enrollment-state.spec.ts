import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';

/**
 * E2E for the derived Registered vs Enrolled engagement states on the family
 * dashboard (issue #23), verified against deployed UAT (https://cmt-setu.vercel.app,
 * backed by chinmaya-setu-uat Firestore). Auth is the shared E2E family's
 * password sign-in (never OTP) via the `setu` project storageState.
 *
 * PREREQUISITES:
 *   1. This branch is deployed to UAT (the derived bvState shipped in Tasks 1–6).
 *   2. The controller ran the PLAIN seed first — `pnpm --filter @cmt/portal
 *      seed:e2e-family` — so the fixture is in its "Registered" ground state:
 *      the sole ACTIVE bala-vihar enrollment is the promoted 2026-27 offering
 *      with NO engagement (2025-26 attendance is window/oid-scoped out, no
 *      completed 2026-27 donation).
 *
 * WHAT EACH PHASE ASSERTS:
 *   - Phase 1 (Registered ground state): GET /api/setu/dashboard →
 *     balaVihar.bvState === 'registered' && isEnrolled === true; and /family
 *     renders the confirm nudge (desktop), plus — at a mobile viewport (the
 *     Registered pill + the family-facing "Give donation" CTA are the mobile
 *     layout only) — the `Registered` pill, the verbatim nudge, and a visible
 *     `Give donation` link pointing at `/family/donate?eid=…`.
 *   - Phase 2 (Enrolled after a completed donation): the spec SELF-MUTATES the
 *     fixture by re-running the seed with `--confirm-bv` (writes one _test
 *     completed donation for the active 2026-27 eid), then asserts bvState ===
 *     'enrolled' (API) and the mobile pill flips to `Enrolled` with the nudge
 *     ABSENT.
 *
 * SELF-RESETTING: Phase 2's beforeAll shells out `seed:e2e-family --confirm-bv`;
 * afterAll re-runs the PLAIN seed (which deletes that _test donation) to restore
 * the Registered ground state, so the suite is idempotent. The seed reuses the
 * same fid + uid (stable) and does NOT revoke sessions (Admin-SDK updateUser with
 * an unchanged password sets no tokensValidAfterTime), so the storageState
 * session survives the reseed — no re-sign-in needed.
 *
 * execSync-to-seed is an established house pattern (e2e/setu/registration/
 * {join-request,profile-completion}.spec.ts re-seed their own fixtures the same
 * way). NEW here: forwarding a FLAG through pnpm — done with the canonical `--`
 * separator so pnpm passes `--confirm-bv` to the tsx script's process.argv
 * (no precedent spec forwards a flag, so `--` is used rather than the bare form).
 *
 * Serial so the two phases (which share + mutate the one fixture) never
 * interleave and the mutation ordering is deterministic.
 */

const NUDGE = 'Attend your first class or complete your donation to confirm enrollment.';
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

interface DashboardBv {
  balaVihar: { bvState: string; isEnrolled: boolean };
}

/** Re-run the E2E family seed against UAT. `flags` are forwarded via the `--`
 *  separator so pnpm passes them to the script (not to pnpm itself). */
function reseedE2eFamily(flags: string[] = []): void {
  const suffix = flags.length ? ` -- ${flags.join(' ')}` : '';
  execSync(`pnpm --filter @cmt/portal seed:e2e-family${suffix}`, {
    // Spec runs from apps/portal; the pnpm --filter workspace command runs from
    // the repo root (two levels up). Mirrors join-request/profile-completion.
    cwd: resolve(process.cwd(), '..', '..'),
    stdio: 'inherit',
    timeout: 120_000,
  });
}

test.describe.serial('enrollment engagement state — Registered vs Enrolled (issue #23)', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required (run seed:e2e-family first)');

  // ── Phase 1: Registered ground state (controller ran the plain seed) ────────
  test('API: dashboard reports bvState=registered, isEnrolled=true', async ({ request }) => {
    const res = await request.get('/api/setu/dashboard');
    expect(res.status(), `dashboard GET: ${await res.text()}`).toBe(200);
    const { balaVihar } = (await res.json()) as DashboardBv;
    expect(balaVihar.isEnrolled).toBe(true);
    expect(balaVihar.bvState).toBe('registered');
  });

  test('UI (desktop): /family shows the confirm nudge copy', async ({ page }) => {
    await page.goto('/family');
    await expect(visibleText(page, NUDGE).first()).toBeVisible();
  });

  test.describe('UI (mobile viewport)', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test('shows the Registered pill, the nudge, and a Give donation CTA to /family/donate?eid=', async ({ page }) => {
      await page.goto('/family');
      // The Registered pill lives in the mobile BV card only (desktop hardcodes
      // an "Enrolled" pill whenever a BV enrollment exists).
      await expect(visibleText(page, /^Registered$/).first()).toBeVisible();
      await expect(visibleText(page, NUDGE).first()).toBeVisible();
      const give = page.getByRole('link', { name: /Give donation/i }).filter({ visible: true }).first();
      await expect(give).toBeVisible();
      await expect(give).toHaveAttribute('href', /\/family\/donate\?eid=/);
    });
  });

  // ── Phase 2: Enrolled after a completed donation (self-mutates the fixture) ──
  test.describe('after a completed donation (--confirm-bv)', () => {
    test.beforeAll(() => {
      reseedE2eFamily(['--confirm-bv']);
    });

    test('API: dashboard reports bvState=enrolled', async ({ request }) => {
      const res = await request.get('/api/setu/dashboard');
      expect(res.status(), `dashboard GET: ${await res.text()}`).toBe(200);
      const { balaVihar } = (await res.json()) as DashboardBv;
      expect(balaVihar.isEnrolled).toBe(true);
      expect(balaVihar.bvState).toBe('enrolled');
    });

    test.describe('UI (mobile viewport)', () => {
      test.use({ viewport: MOBILE_VIEWPORT });

      test('flips the pill to Enrolled and drops the confirm nudge', async ({ page }) => {
        await page.goto('/family');
        await expect(visibleText(page, /^Enrolled$/).first()).toBeVisible();
        // Confirmed → no nudge anywhere in the DOM (neither layout renders it).
        await expect(page.getByText(NUDGE)).toHaveCount(0);
      });
    });
  });

  // ── Cleanup: restore the Registered ground state (deletes the _test donation) ─
  test.afterAll(() => {
    reseedE2eFamily();
  });
});
