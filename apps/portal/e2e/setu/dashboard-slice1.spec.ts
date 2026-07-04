import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, request as apiRequest } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';
import { signInFamilyAndSaveStorage } from '../auth-helpers';

/**
 * E2E for the Slice 1 rebuilt family dashboard, verified against deployed UAT
 * (https://cmt-setu.vercel.app, backed by chinmaya-setu-uat Firestore). Auth is
 * the shared E2E family's password sign-in (never OTP) via the `setu` project
 * storageState. Structured as serial phases so the two states (which share +
 * mutate the ONE E2E fixture) never interleave.
 *
 * WHAT EACH PHASE ASSERTS (Slice 1 spec, owner decisions 2026-07-03/07-06):
 *   - Phase A — family-initiated → Enrolled + Pending. Seeds the active 2026-27
 *     BV enrollment with enrolledVia:'family-initiated' (the family clicked
 *     Enroll). Per Slice 1 Part A a DELIBERATE enroll confirms on its own, so the
 *     dashboard reads "Enrolled" immediately even with $0 donated — while the
 *     donation stays "Pending" and the BV section shows a "Complete donation"
 *     link (the donation CTA lives ONLY in the BV section now, never as an Action
 *     Item). The dashboard must NOT render a Seva or Prasad section, nor an
 *     email/phone contacts nudge; and it shows the Family card + "Manage family".
 *   - Phase B — promotion-only → still Registered. Reseeds the same enrollment
 *     with enrolledVia:'promotion' (rollover carry-forward) and NO engagement, so
 *     it stays in issue #23's "Registered" carry-you-forward state.
 *
 * RE-AUTH AFTER RESEED (memory feedback_e2e_reseed_invalidates_session): the seed
 * calls `auth.updateUser(uid, { password })` on EVERY run, which bumps the
 * Firebase user's `tokensValidAfterTime` and invalidates the session established
 * by auth.setup. So BOTH phases reseed in their beforeAll and then re-sign-in via
 * `signInFamilyAndSaveStorage` (the same route auth.setup uses), overwriting the
 * shared storageState file — Playwright re-reads it when it creates each per-test
 * `request`/`page` fixture, so every test in the phase carries a live session.
 * That is exactly TWO extra sign-ins per full run (one per phase), well under the
 * 5-per-15-min password-sign-in limiter.
 *
 * The desktop layout is the one under test: the `setu` project runs Desktop
 * Chrome, so the `hidden md:block` desktop blocks are visible and the
 * `block md:hidden` mobile blocks are display:none — `visibleText`/
 * `.filter({ visible: true })` pick the visible copy (both layouts share the same
 * BV-section JSX, so "Complete donation" / "Manage family" exist twice in the DOM).
 *
 * SHARED-FIXTURE NOTE: this spec and enrollment-state.spec.ts (issue #23) both
 * reseed the SAME E2E family. Run this spec on its own (the owner-gate command
 * targets `dashboard-slice1`); do NOT run it in the same invocation as
 * enrollment-state.spec.ts, or the two files' reseeds would race. Phase B leaves
 * the fixture in the plain "Registered" ground state, so no afterAll reset is
 * needed.
 *
 * PRECONDITION (flags OFF in UAT): the Seva/Prasad "not rendered" assertions rely
 * on NEXT_PUBLIC_FEATURE_SETU_SEVA / NEXT_PUBLIC_FEATURE_SETU_PRASAD being unset
 * (their default) in the UAT Vercel env. The family sidebar gates Seva behind
 * flags.setuSeva and never lists Prasad, so with the flags off neither word
 * appears on /family. NOTE the admin fixture DOES render a "Sevak" sidebar
 * heading, so the guards use word-boundary regexes (`/\bseva\b/i`, `/\bprasad\b/i`)
 * that match a standalone "Seva"/"Prasad" section but NOT the "Sevak" substring.
 */

/** Re-run the E2E family seed against UAT. `flags` are forwarded via the `--`
 *  separator so pnpm passes them to the tsx script (not to pnpm itself). Mirrors
 *  enrollment-state.spec.ts / registration specs. */
function reseedE2eFamily(flags: string[] = []): void {
  const suffix = flags.length ? ` -- ${flags.join(' ')}` : '';
  execSync(`pnpm --filter @cmt/portal seed:e2e-family${suffix}`, {
    // The spec runs from apps/portal; the pnpm --filter workspace command runs
    // from the repo root (two levels up).
    cwd: resolve(process.cwd(), '..', '..'),
    stdio: 'inherit',
    timeout: 120_000,
  });
}

/** Re-establish the E2E family session after a mid-suite reseed (the seed's
 *  `auth.updateUser(uid, { password })` invalidates the existing __session).
 *  Uses a fresh APIRequestContext because the per-test `request` fixture is not
 *  available in a `beforeAll` hook; `signInFamilyAndSaveStorage` overwrites the
 *  shared storageState the next-created fixtures load. */
async function reauthE2eFamily(): Promise<void> {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
  const ctx = await apiRequest.newContext({ baseURL });
  try {
    await signInFamilyAndSaveStorage(ctx);
  } finally {
    await ctx.dispose();
  }
}

test.describe.serial('Slice 1 dashboard', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required (run seed:e2e-family first)');

  // ── Phase A: family-initiated → Enrolled + Pending ──────────────────────────
  test.describe('family-initiated → Enrolled + donation Pending', () => {
    test.beforeAll(async () => {
      // Deliberate enroll: Slice 1 reads it "Enrolled" on its own, $0 or not.
      reseedE2eFamily(['--enrolled-via', 'family-initiated']);
      // The reseed bumped tokensValidAfterTime → the storageState session is dead.
      await reauthE2eFamily();
    });

    test('reads Enrolled with the donation Pending and a Complete donation button in the BV section', async ({ page }) => {
      await page.goto('/family');

      // The BV bespoke section (the "Enrolled" pill / metric only ever reads
      // "Enrolled" here — Slice 1 removed the other-program cards from the home).
      await expect(visibleText(page, 'Bala Vihar').first()).toBeVisible();
      await expect(visibleText(page, /^Enrolled$/).first()).toBeVisible();

      // Donation is still Pending (family-initiated confirms on intent, not money).
      // Exact-match so the "Pending join requests" panel can't false-match.
      await expect(visibleText(page, /^Pending$/).first()).toBeVisible();

      // The donation CTA lives ONLY in the BV section now (never an Action Item).
      // It is a BUTTON that POSTs to checkout and redirects straight to Stripe
      // (2026-07-04) — no longer a link to /family/donate.
      const complete = page
        .getByRole('button', { name: /complete donation/i })
        .filter({ visible: true })
        .first();
      await expect(complete).toBeVisible();
    });

    test('does NOT render a Seva or Prasad section, nor an email/phone contacts nudge', async ({ page }) => {
      await page.goto('/family');
      // Word-boundary regexes: a standalone "Seva"/"Prasad" section would match,
      // but the admin fixture's "Sevak" sidebar heading (substring) does NOT.
      await expect(page.getByText(/\bseva\b/i)).toHaveCount(0);
      await expect(page.getByText(/\bprasad\b/i)).toHaveCount(0);
      // The one-time "add your other contacts" nudge is not part of the rebuilt
      // dashboard.
      await expect(page.getByText(/add your (email|phone|other contact)/i)).toHaveCount(0);
    });

    test('shows the Family card and the Manage family link', async ({ page }) => {
      await page.goto('/family');
      // Desktop Family card heading: "Family · N members".
      await expect(visibleText(page, /^Family · \d+ member/).first()).toBeVisible();
      const manage = page
        .getByRole('link', { name: /manage family/i })
        .filter({ visible: true })
        .first();
      await expect(manage).toBeVisible();
      await expect(manage).toHaveAttribute('href', '/family/members');
    });
  });

  // ── Phase B: promotion-only → registered state, but the web reads "Enrolled" ─
  test.describe('promotion-only → registered state renders as Enrolled', () => {
    test.beforeAll(async () => {
      // Rollover carry-forward with no engagement → issue #23 'registered' bvState.
      reseedE2eFamily(['--enrolled-via', 'promotion']);
      await reauthE2eFamily();
    });

    test('a promotion enrollment with no engagement reads Enrolled on the web (registered only in the API)', async ({ page }) => {
      await page.goto('/family');
      // Vaibhav 2026-07-04: the web no longer surfaces "Registered"; the BV pill +
      // stat read "Enrolled" even in the promotion-only (registered) state.
      await expect(visibleText(page, /^Enrolled$/).first()).toBeVisible();
      await expect(page.getByText(/^Registered$/)).toHaveCount(0);
    });
  });
});
