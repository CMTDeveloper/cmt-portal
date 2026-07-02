import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, request as apiRequest } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';
import { signInFamilyAndSaveStorage } from '../auth-helpers';

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
 *     balaVihar.bvState === 'registered' && isEnrolled === true; and /family on
 *     DESKTOP renders both the verbatim confirm nudge AND the three-state
 *     `Registered` pill (issue #23 I2 made the desktop pill + metric
 *     bvState-driven, matching mobile — desktop no longer hardcodes "Enrolled").
 *     At a mobile viewport (where the family-facing "Give donation" CTA lives)
 *     it also shows the `Registered` pill, the nudge, and a visible `Give
 *     donation` link pointing at `/family/donate?eid=…`.
 *   - Phase 2 (Enrolled after a completed donation): the spec SELF-MUTATES the
 *     fixture by re-running the seed with `--confirm-bv` (writes one _test
 *     completed donation for the active 2026-27 eid), then asserts bvState ===
 *     'enrolled' (API); that DESKTOP leaves the Registered state (`/^Registered$/`
 *     count 0 — the robust form, since `/^Enrolled$/` also matches the
 *     om-chanting card's hardcoded pill) with the nudge gone; and that the mobile
 *     pill flips to `Enrolled` with the nudge ABSENT.
 *
 * SELF-RESETTING: Phase 2's beforeAll shells out `seed:e2e-family --confirm-bv`;
 * afterAll re-runs the PLAIN seed (which deletes that _test donation) to restore
 * the Registered ground state, so the suite is idempotent. The seed reuses the
 * same fid + uid (stable).
 *
 * RE-AUTH AFTER RESEED (issue #23): the seed calls `auth.updateUser(uid, {
 * password })` on EVERY run, which bumps the Firebase user's
 * `tokensValidAfterTime` and invalidates the session established by
 * auth.setup — so the storageState session is DEAD after a mid-suite reseed
 * (a 401 `no-session` on the first Phase-2 request, before this fix). The
 * Phase-2 beforeAll therefore re-signs-in via the same password-sign-in route
 * auth.setup uses (`signInFamilyAndSaveStorage`) and overwrites the shared
 * storageState file; Playwright re-reads that file when it creates each
 * per-test fixture, so BOTH the API `request` and the browser `page` fixtures
 * of the Phase-2 tests load the fresh session. This adds exactly ONE extra
 * sign-in per run (well under the 5-per-15-min password-sign-in limiter). The
 * afterAll reseed also invalidates the session, but nothing runs after it in
 * this serial spec, so it deliberately skips the re-auth.
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

/** Re-establish the E2E family session after a mid-suite reseed (the seed's
 *  `auth.updateUser(uid, { password })` invalidates the existing __session).
 *  Mirrors auth.setup: sign in via password-sign-in and overwrite the shared
 *  storageState file so the next-created `request`/`page` fixtures load it.
 *  Uses a fresh APIRequestContext because the per-test `request` fixture is not
 *  available in a `beforeAll` hook. */
async function reauthE2eFamily(): Promise<void> {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
  const ctx = await apiRequest.newContext({ baseURL });
  try {
    await signInFamilyAndSaveStorage(ctx);
  } finally {
    await ctx.dispose();
  }
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

  test('UI (desktop): /family shows the confirm nudge and the Registered pill', async ({ page }) => {
    await page.goto('/family');
    await expect(visibleText(page, NUDGE).first()).toBeVisible();
    // Issue #23 I2: desktop now renders the three-state pill + metric (it used to
    // hardcode "Enrolled"). `/^Registered$/` is unambiguous — only the BV pill
    // and BV metric ever read "Registered" (the om-chanting card hardcodes
    // "Enrolled"), so a visible match proves the desktop Registered state ships.
    await expect(visibleText(page, /^Registered$/).first()).toBeVisible();
  });

  test.describe('UI (mobile viewport)', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test('shows the Registered pill, the nudge, and a Give donation CTA to /family/donate?eid=', async ({ page }) => {
      await page.goto('/family');
      // The Registered pill renders in both layouts now; at this mobile viewport
      // the visible one is the mobile BV card's.
      await expect(visibleText(page, /^Registered$/).first()).toBeVisible();
      await expect(visibleText(page, NUDGE).first()).toBeVisible();
      const give = page.getByRole('link', { name: /Give donation/i }).filter({ visible: true }).first();
      await expect(give).toBeVisible();
      await expect(give).toHaveAttribute('href', /\/family\/donate\?eid=/);
    });
  });

  // ── Phase 2: Enrolled after a completed donation (self-mutates the fixture) ──
  test.describe('after a completed donation (--confirm-bv)', () => {
    test.beforeAll(async () => {
      reseedE2eFamily(['--confirm-bv']);
      // The reseed bumped tokensValidAfterTime → the storageState session is now
      // dead. Re-sign-in so the Phase-2 request/page fixtures carry a live one.
      await reauthE2eFamily();
    });

    test('API: dashboard reports bvState=enrolled', async ({ request }) => {
      const res = await request.get('/api/setu/dashboard');
      expect(res.status(), `dashboard GET: ${await res.text()}`).toBe(200);
      const { balaVihar } = (await res.json()) as DashboardBv;
      expect(balaVihar.isEnrolled).toBe(true);
      expect(balaVihar.bvState).toBe('enrolled');
    });

    test('UI (desktop): the BV pill leaves the Registered state and the nudge is gone', async ({ page }) => {
      await page.goto('/family');
      // Robust form (issue #23 I2): assert the desktop surface no longer reads
      // "Registered" rather than positively matching `/^Enrolled$/`, which the
      // om-chanting card's hardcoded pill also satisfies. Only the BV pill/metric
      // ever render "Registered", so DOM-wide count 0 proves both flipped away
      // from it; together with the co-located API assertion (bvState ===
      // 'enrolled'), the desktop pill + metric now read "Enrolled". The confirm
      // nudge is gone on desktop too.
      await expect(page.getByText(/^Registered$/)).toHaveCount(0);
      await expect(page.getByText(NUDGE)).toHaveCount(0);
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
