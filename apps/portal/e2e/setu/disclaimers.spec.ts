import { test, expect, request as pwRequest } from '@playwright/test';
import { hasFamilyCreds } from '../_helpers';
import { signInFamilyAndSaveStorage } from '../auth-helpers';

/**
 * E2E for the Slice 2 family-disclaimers gate, verified against deployed UAT
 * (https://cmt-setu.vercel.app, backed by chinmaya-setu-uat Firestore). Auth is
 * the shared E2E family's password sign-in (never OTP) via the `setu` project
 * storageState — the SAME account is both family-manager AND admin (the seed
 * grants admin), so this one session drives BOTH the admin content editor
 * (PUT /api/admin/disclaimers) and the family accept flow.
 *
 * WHAT IT ASSERTS:
 *   1. Publishing a new admin content version bumps `version`, which makes the
 *      shared fixture's prior acceptance STALE (drives it "pending" through the
 *      REAL API — no shelling out to the seed mid-run).
 *   2. Visiting /family then bounces to /acknowledgements (the layout DisclaimerGate).
 *   3. The accept screen shows the intro + sections (each with its own checkbox) +
 *      acknowledgement; clicking "I Acknowledge" before every section is ticked
 *      shows a validation error and does NOT proceed.
 *   4. Ticking every section then accepting hard-navigates to /family and the gate
 *      no longer fires on a re-visit.
 *
 * The admin PUT round-trips intro + sections + acknowledgement (the content model
 * carries all three) so publishing/restoring here never blanks the live intro or
 * acknowledgement.
 *
 * PRECONDITION (owner gate): NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS=true must be set
 * in the UAT Vercel env, and the shared fixture seeded `--disclaimers accepted`
 * (its default) — otherwise every sibling setu spec's /family navigation would
 * bounce to /acknowledgements. This file is WRITE-ONLY in Task 11; it runs at the
 * owner gate AFTER the batch push + Vercel deploy + flag flip.
 *
 * Serial: shared fixture. The whole file drives the ONE E2E family manager (also
 * admin). We flip the fixture to "pending" up front and restore "accepted" in
 * afterAll so no sibling spec is left gated.
 */
test.describe.configure({ mode: 'serial' });

// Same base-URL mechanism the Slice 1 setu specs use (there is no E2E_BASE_URL
// export): PLAYWRIGHT_BASE_URL when targeting deployed UAT, else the local
// dev:e2e server. Used only for the beforeAll/afterAll `request.newContext`
// re-auth; the per-test `page`/`request` fixtures get baseURL from the config.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

// A deep copy of the PRE-mutation content (intro + sections + acknowledgement)
// captured in the test, so the afterAll can PUT the original content back and stop
// this spec permanently appending `(rev <ms>)` to section 0's body — or blanking
// the intro/acknowledgement — in the shared UAT config doc.
let originalContent: { intro: string; sections: unknown[]; acknowledgement: string } | null = null;

test.beforeAll(async () => {
  // Skip the whole file when creds are absent (CI without .env.local), matching
  // the codebase convention that setu specs self-skip without a family session.
  if (!hasFamilyCreds) return;
  // Fresh session (the shared storageState may be stale from a sibling reseed).
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
  await signInFamilyAndSaveStorage(ctx);
  await ctx.dispose();
});

test('manager is gated to /acknowledgements, accepts, and reaches the dashboard', async ({ page, request }) => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required (run seed:e2e-family first)');

  // 1) Make the fixture "pending" by publishing a new admin version (bumps the
  //    content version → the fixture's prior acceptance is now stale). Round-trip
  //    intro + acknowledgement so publishing never blanks them.
  const editRes = await request.get('/api/admin/disclaimers');
  expect(editRes.ok()).toBeTruthy();
  const { intro, sections, acknowledgement } = await editRes.json();
  // Snapshot the ORIGINAL content BEFORE mutating so afterAll can restore it.
  originalContent = JSON.parse(JSON.stringify({ intro, sections, acknowledgement }));
  const bumped = sections.map((s: { id: string; title: string; body: string }, i: number) =>
    i === 0 ? { ...s, body: `${s.body} (rev ${Date.now()})` } : s,
  );
  const pubRes = await request.put('/api/admin/disclaimers', { data: { intro, sections: bumped, acknowledgement } });
  expect(pubRes.ok()).toBeTruthy();

  // 2) Visiting /family now bounces to /acknowledgements (hard nav re-runs the gate).
  await page.goto('/family');
  await expect(page).toHaveURL(/\/acknowledgements$/);

  // 3) The accept screen shows a checkbox on EVERY section. Clicking "I Acknowledge"
  //    before ticking them all surfaces a validation error and does NOT proceed.
  const acceptBtn = page.getByTestId('disclaimers-accept');
  await expect(acceptBtn).toHaveText(/I Acknowledge/);
  await expect(page.getByText(bumped[0].title, { exact: false }).first()).toBeVisible();
  await acceptBtn.click(); // nothing ticked yet
  await expect(page.getByTestId('disclaimer-ack-error')).toBeVisible();
  await expect(page).toHaveURL(/\/acknowledgements$/); // did not proceed

  // 4) Tick every section (clears the error), accept → hard nav to /family, and no
  //    more gate on re-visit.
  for (const s of bumped) {
    await page.getByTestId(`disclaimer-check-${s.id}`).click();
  }
  await expect(page.getByTestId('disclaimer-ack-error')).toHaveCount(0);
  await acceptBtn.click();
  await expect(page).toHaveURL(/\/family$/);
  await page.goto('/family');
  await expect(page).toHaveURL(/\/family$/);
});

test.afterAll(async () => {
  if (!hasFamilyCreds) return;
  // Restore an accepted ground state so sibling specs aren't gated: sign in and
  // POST accept for the CURRENT version (the test above already accepted, but
  // this is a belt-and-braces restore in case it failed mid-way).
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
  await signInFamilyAndSaveStorage(ctx);
  // Restore the ORIGINAL content (intro + sections + acknowledgement) so we don't
  // permanently pollute the shared UAT config doc with the `(rev <ms>)` body bump
  // or blank the intro/acknowledgement. Wrapped so a cleanup failure never fails
  // the suite.
  if (originalContent) {
    try {
      await ctx.put('/api/admin/disclaimers', { data: originalContent });
    } catch {
      // best-effort restore; ignore
    }
  }
  await ctx.post('/api/setu/disclaimers/accept');
  await ctx.dispose();
});
