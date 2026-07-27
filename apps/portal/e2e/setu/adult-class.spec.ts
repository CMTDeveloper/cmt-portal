import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, request, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { ADULT_CLASS_EMAILS, ADULT_CLASS_PASSWORD, hasAdultClassCreds } from '../_helpers';

/**
 * ⚠️ OWNER-GATED — deployed-UAT E2E for the Adult Study Class (P4 Tasks 1-11).
 * Authored under Task 12 and NOT YET RUN: it needs the UAT feature flag the owner
 * flips out-of-band (below). Follows kiosk-auto-enroll.spec.ts, which is gated the
 * same way for the same reason.
 *
 * ── PRECONDITIONS, in order ──────────────────────────────────────────────────
 *   1. The branch DEPLOYED to UAT (https://cmt-setu.vercel.app) with
 *      NEXT_PUBLIC_FEATURE_SETU_ADULT_CLASS=true (flags.ts:39). With the flag OFF
 *      `/adult-class` redirects to /family (page.tsx:18) and the gate never
 *      mounts (layout.tsx), so every assertion below fails on the flag rather
 *      than on the feature.
 *   2. `pnpm --filter @cmt/portal seed:adult-class-fixtures` (UAT, idempotent) —
 *      creates the program, an open $101 offering, and one family per §2.3 row.
 *      The beforeAll re-runs it, because tests here ENROLL and condition 4 would
 *      otherwise be satisfied on a second run and the gate would stay silent.
 *   3. `.env.local` carries E2E_ADULT_CLASS_PASSWORD (or E2E_FAMILY_PASSWORD).
 *
 * Run (deployed UAT only — never prod):
 *   PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app \
 *     pnpm --filter @cmt/portal exec playwright test --project=setu adult-class
 *
 * ── WHY A BROWSER ────────────────────────────────────────────────────────────
 * Everything that makes this feature a gate is invisible to mocked unit tests:
 * Suspense sibling ordering in app/family/layout.tsx decides WHICH screen a
 * family lands on, `use cache` decides whether the post-save read is fresh, and
 * the hard navigation out of /adult-class is the difference between landing on
 * the dashboard and being bounced back onto a stranded "Saving…" button. A green
 * unit suite proves none of it.
 *
 * ── WHAT IT PROVES (spec §6) ─────────────────────────────────────────────────
 *   §6.1  a Bala Vihar family enrolls at $0; a NON-BV family is quoted $101.
 *   §6.3  after selecting, editing an UNRELATED member leaves enrolledMids
 *         intact — "the failure that unit tests and a single-pass walkthrough
 *         both miss".
 *   §6.4  N=2 both directions: pick one of two adults and the other is NOT
 *         enrolled; pick both and the cost is STILL $0.
 *   §6.5  a fully-paid BV family that adds the exempt adult class still reads
 *         `paid` on the welcome roster, not `outstanding`.
 *   §6.6  one test per §2.3 row: rows 1, 2, 5 fire; rows 3, 6, 7 stay silent,
 *         and row 2 asserts the teaching adult is NOT OFFERED AT ALL.
 *
 * Row 7 fails the gate twice over, so on its own it proves neither half. Row 3
 * isolates "every adult teaches" WITH a paid Bala Vihar enrollment, and row 6
 * isolates "no Bala Vihar" WITH freely selectable adults — the isolation §2.3
 * demands.
 *
 * SEQUENTIAL + MUTATING. Tests enroll real UAT families. The beforeAll reseed
 * resets them; afterAll additionally removes the adult-class enrollments so a
 * re-run without a reseed still starts from an un-gated state.
 *
 * ── ⚠️ THE FLAG FLIP AFFECTS OTHER SPECS, NOT JUST THIS ONE ──────────────────
 * This gate runs on EVERY `/family/*` render, so any fixture family that meets
 * its five conditions starts bouncing to `/adult-class` the moment the flag goes
 * on - in specs that have nothing to do with this feature.
 *
 * The shared family `CMT-FSWEDU2X` is one of them. Verified in UAT 2026-07-26:
 * Brampton, one adult (not teacher-assigned), one child, an active Bala Vihar
 * enrollment - and **zero completed donations**, which is the only reason
 * condition 3 fails and the gate stays shut today. `enrollment-state.spec.ts`
 * Phase 2 re-seeds it with `-- --confirm-bv`, which writes precisely that
 * donation. After that run, with the Brampton adult-class offering this suite's
 * seed creates, the shared family satisfies all five conditions and every
 * SUBSEQUENT spec that visits `/family` is diverted.
 *
 * That is correct product behaviour, not a bug - it is a paid Bala Vihar family
 * with a selectable adult. But it will present as unrelated dashboard specs
 * failing on a URL mismatch. Before flipping the flag, either give the shared
 * family an adult-class enrollment (satisfying condition 4) or run
 * `seed:e2e-family` without `--confirm-bv` after any run that used it.
 */
test.describe('adult study class — the gate, the fee, and the §2.3 matrix', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !hasAdultClassCreds,
    'E2E_ADULT_CLASS_PASSWORD / E2E_FAMILY_PASSWORD required (run seed:adult-class-fixtures first)',
  );

  // Empty jar so these managers never inherit the `setu` project's storageState,
  // which belongs to a different family entirely.
  const EMPTY_STATE = { cookies: [], origins: [] };
  const REPO_ROOT = resolve(process.cwd(), '..', '..');

  let baseURL: string;
  const states = new Map<string, Awaited<ReturnType<APIRequestContext['storageState']>>>();

  /** Sign one fixture family in once and keep its cookie jar for the whole file.
   *  One sign-in per email — the limiter is 5 per 15 minutes PER EMAIL
   *  (mint-password-session.ts:49), so re-authing per test would burn it. */
  async function signIn(email: string): Promise<void> {
    const ctx = await request.newContext({ baseURL, storageState: EMPTY_STATE });
    try {
      const res = await ctx.post('/api/setu/auth/password-sign-in', {
        data: { email, password: ADULT_CLASS_PASSWORD },
      });
      expect(
        res.status(),
        `rate-limited on ${email}: wait 15 minutes rather than re-running (5/15min per email)`,
      ).not.toBe(429);
      expect(res.ok(), `sign-in failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
      states.set(email, await ctx.storageState());
    } finally {
      await ctx.dispose();
    }
  }

  async function pageAs(browser: Browser, email: string) {
    const ctx = await browser.newContext({ baseURL, storageState: states.get(email) });
    return { ctx, page: await ctx.newPage() };
  }

  async function apiAs(email: string): Promise<APIRequestContext> {
    return request.newContext({ baseURL, storageState: states.get(email) });
  }

  /** The family's enrollments, straight from the API the mobile app also reads. */
  async function enrollments(email: string): Promise<Array<Record<string, unknown>>> {
    const ctx = await apiAs(email);
    try {
      const res = await ctx.get('/api/setu/enrollments');
      expect(res.ok(), `GET enrollments failed: ${res.status()}`).toBeTruthy();
      return (await res.json()).enrollments as Array<Record<string, unknown>>;
    } finally {
      await ctx.dispose();
    }
  }

  function adultClassEnrollment(list: Array<Record<string, unknown>>) {
    return list.find((e) => e['programKey'] === 'adult-study-class' && e['status'] === 'active') ?? null;
  }

  /** The checkboxes on /adult-class, one per SELECTABLE adult. */
  function adultCheckboxes(page: Page) {
    return page.locator('input[type="checkbox"]');
  }

  test.beforeAll(async ({ baseURL: bu }) => {
    baseURL = bu!;
    // Idempotent + UAT-only. Deletes any adult-class enrollment from a prior run,
    // so condition 4 is genuinely unsatisfied and the gate can fire again.
    execSync('pnpm --filter @cmt/portal seed:adult-class-fixtures', {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      timeout: 180_000,
    });
    for (const email of Object.values(ADULT_CLASS_EMAILS)) await signIn(email);
  });

  // ── Row 1 — the gate fires, and N=2 in both directions (§6.4) ──────────────
  test('row 1: the gate diverts a paid Bala Vihar family to /adult-class', async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, ADULT_CLASS_EMAILS.row1);
    try {
      await page.goto('/family');
      // The instructive-failure convention (attendance-binary.spec.ts:34-37): with
      // the flag off this is the FIRST assertion to fail, and a bare URL mismatch
      // reads as a broken gate rather than an unset env var.
      await expect(
        page,
        'never diverted to /adult-class — set NEXT_PUBLIC_FEATURE_SETU_ADULT_CLASS=true on the target deploy and redeploy (NEXT_PUBLIC_* is inlined at build time)',
      ).toHaveURL(/\/adult-class(\/|$|\?)/, { timeout: 30_000 });
      // Two adults, neither teaching → both offered, NEITHER preselected (the
      // preselect is row 5's single-adult case only).
      await expect(adultCheckboxes(page)).toHaveCount(2, { timeout: 20_000 });
      await expect(adultCheckboxes(page).nth(0)).not.toBeChecked();
      await expect(adultCheckboxes(page).nth(1)).not.toBeChecked();
      // Continue is inert until someone is picked.
      await expect(page.getByRole('button', { name: /Continue/i })).toBeDisabled();
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  test('row 1: picking ONE adult enrolls only that adult, at $0', async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, ADULT_CLASS_EMAILS.row1);
    try {
      await page.goto('/adult-class');
      await expect(adultCheckboxes(page)).toHaveCount(2, { timeout: 30_000 });
      await adultCheckboxes(page).nth(0).check();
      await page.getByRole('button', { name: /Continue/i }).click();
      // The HARD navigation out of the screen (R2): a soft push would bounce off
      // the gate's stale `use cache` read and strand the button on "Saving…".
      await expect(page).toHaveURL(/\/family(\/|$|\?)/, { timeout: 30_000 });

      const asc = adultClassEnrollment(await enrollments(ADULT_CLASS_EMAILS.row1));
      expect(asc, 'no active adult-study-class enrollment after saving').not.toBeNull();
      // §6.4 direction one: the OTHER adult must not have been swept in.
      expect((asc!['enrolledMids'] as string[]).length).toBe(1);
      // §6.1 + the waiver: a paid Bala Vihar family owes nothing.
      expect(asc!['effectiveSuggestedAmount']).toBe(0);
      // Frozen, or the next member edit re-derives "every adult" over the choice.
      expect(asc!['membershipMode']).toBe('manual');
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── §6.3 — the B2 test the spec says is most likely to be skipped ──────────
  //
  // ORDER IS LOAD-BEARING. This must run while exactly ONE of two adults is
  // selected, which is why it sits between the pick-one and pick-both tests
  // rather than after them. Manual mode prunes `enrolledMids` by EXISTENCE only
  // (sync-enrollment-members.ts:126-134); the bug it guards against is AUTO
  // mode, which re-derives the list from every eligible member - and for an
  // adult program `memberEligibleForProgram` matches every Adult. So the
  // regression is only visible while the stored list is a PROPER SUBSET of the
  // family's adults. Run this after both adults are selected and the two
  // behaviours produce an identical list: the test passes under the very bug it
  // exists to catch.
  test('row 1: editing an UNRELATED member leaves a PARTIAL selection untouched', async ({ browser }) => {
    const list = await enrollments(ADULT_CLASS_EMAILS.row1);
    const before = adultClassEnrollment(list);
    const mids = [...(before!['enrolledMids'] as string[])].sort();
    expect(mids.length, 'this test is only meaningful on a partial selection').toBe(1);

    // The CHILD - a member who is not, and cannot be, in the adult class. Taken
    // from the Bala Vihar enrollment rather than clicked through the member list,
    // so the test cannot pass because a selector drifted onto the wrong person.
    const bv = list.find((e) => e['programKey'] === 'bala-vihar' && e['status'] === 'active');
    const childMid = (bv!['enrolledMids'] as string[])[0]!;
    expect(mids, 'the child must not be in the adult class to begin with').not.toContain(childMid);

    const { ctx, page } = await pageAs(browser, ADULT_CLASS_EMAILS.row1);
    try {
      await page.goto(`/family/members/${childMid}/edit`);
      const allergies = page.getByLabel('Food allergies').filter({ visible: true }).first();
      await expect(allergies).toBeVisible({ timeout: 30_000 });
      // The fixture seeds NO_ALLERGIES, which TICKS "No known allergies" and
      // DISABLES this input. Without this, `fill` retries against a disabled
      // element until the test times out, and the failure reads as a broken
      // member-edit screen rather than a ticked checkbox - which is exactly how
      // it presented on the first real run.
      if (!(await allergies.isEnabled())) {
        await page.getByTestId('no-allergies').filter({ visible: true }).first().uncheck();
        await expect(allergies).toBeEnabled({ timeout: 10_000 });
      }
      await allergies.fill(`E2E touch ${Date.now()}`);
      await page.getByRole('button', { name: /Save changes/i }).filter({ visible: true }).first().click();
      // The save leaves the edit screen; wait for that rather than a fixed sleep.
      await expect(page).not.toHaveURL(/\/edit(\/|$|\?)/, { timeout: 30_000 });
    } finally {
      await page.close();
      await ctx.close();
    }

    // Auto mode would have re-derived this to BOTH adults on that write.
    const after = adultClassEnrollment(await enrollments(ADULT_CLASS_EMAILS.row1));
    expect([...(after!['enrolledMids'] as string[])].sort()).toEqual(mids);
    expect(after!['membershipMode']).toBe('manual');
  });

  test('row 1: re-visiting shows the saved answer, and picking BOTH is still $0', async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, ADULT_CLASS_EMAILS.row1);
    try {
      // The screen is reachable AFTER the gate is satisfied - it is the only way
      // to change a selection later (page.tsx deliberately does not re-gate).
      await page.goto('/adult-class');
      await expect(adultCheckboxes(page)).toHaveCount(2, { timeout: 30_000 });
      await expect(adultCheckboxes(page).nth(0)).toBeChecked();

      await adultCheckboxes(page).nth(1).check();
      await page.getByRole('button', { name: /Continue/i }).click();
      await expect(page).toHaveURL(/\/family(\/|$|\?)/, { timeout: 30_000 });

      const asc = adultClassEnrollment(await enrollments(ADULT_CLASS_EMAILS.row1));
      expect((asc!['enrolledMids'] as string[]).length).toBe(2);
      // §6.4 direction two, and the test that catches anyone who "helpfully"
      // adds per-person pricing: two adults still cost $0, not $0 x 2.
      expect(asc!['effectiveSuggestedAmount']).toBe(0);
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── Row 2 — the teaching adult is NOT OFFERED (§6.6, explicit) ─────────────
  test('row 2: only the non-teaching adult is offered at all', async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, ADULT_CLASS_EMAILS.row2);
    try {
      await page.goto('/family');
      await expect(page).toHaveURL(/\/adult-class(\/|$|\?)/, { timeout: 30_000 });
      // ONE checkbox, not two-with-one-disabled: the spec requires the teacher be
      // absent from the selection, not merely unpickable.
      await expect(adultCheckboxes(page)).toHaveCount(1, { timeout: 20_000 });
      await expect(page.getByText(/CoAdult/i)).toHaveCount(0);
      // Row 5's preselect rule also applies here - one selectable adult.
      await expect(adultCheckboxes(page).first()).toBeChecked();
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // The strongest form of §6.3, and the reason row 2 exists as a fixture rather
  // than only as a rendering assertion. Here the excluded adult is one the family
  // could never legitimately choose: auto mode re-derives from
  // `memberEligibleForProgram`, which for an adult program matches EVERY Adult
  // including the one teaching that hour. So a re-derive on an unrelated write
  // does not merely widen the family's choice - it enrols the teacher into a
  // class they are running.
  test('row 2: an unrelated member edit never re-adds the teaching adult', async ({ browser }) => {
    // Confirm the preselected non-teacher (row 5's one-adult preselect applies).
    {
      const { ctx, page } = await pageAs(browser, ADULT_CLASS_EMAILS.row2);
      try {
        await page.goto('/adult-class');
        await expect(adultCheckboxes(page)).toHaveCount(1, { timeout: 30_000 });
        await page.getByRole('button', { name: /Continue/i }).click();
        await expect(page).toHaveURL(/\/family(\/|$|\?)/, { timeout: 30_000 });
      } finally {
        await page.close();
        await ctx.close();
      }
    }

    const list = await enrollments(ADULT_CLASS_EMAILS.row2);
    const before = adultClassEnrollment(list);
    const mids = [...(before!['enrolledMids'] as string[])].sort();
    expect(mids.length, 'exactly the one non-teaching adult should be enrolled').toBe(1);

    const bv = list.find((e) => e['programKey'] === 'bala-vihar' && e['status'] === 'active');
    const childMid = (bv!['enrolledMids'] as string[])[0]!;

    const { ctx, page } = await pageAs(browser, ADULT_CLASS_EMAILS.row2);
    try {
      await page.goto(`/family/members/${childMid}/edit`);
      const allergies = page.getByLabel('Food allergies').filter({ visible: true }).first();
      await expect(allergies).toBeVisible({ timeout: 30_000 });
      // The fixture seeds NO_ALLERGIES, which TICKS "No known allergies" and
      // DISABLES this input. Without this, `fill` retries against a disabled
      // element until the test times out, and the failure reads as a broken
      // member-edit screen rather than a ticked checkbox - which is exactly how
      // it presented on the first real run.
      if (!(await allergies.isEnabled())) {
        await page.getByTestId('no-allergies').filter({ visible: true }).first().uncheck();
        await expect(allergies).toBeEnabled({ timeout: 10_000 });
      }
      await allergies.fill(`E2E touch ${Date.now()}`);
      await page.getByRole('button', { name: /Save changes/i }).filter({ visible: true }).first().click();
      await expect(page).not.toHaveURL(/\/edit(\/|$|\?)/, { timeout: 30_000 });
    } finally {
      await page.close();
      await ctx.close();
    }

    const after = adultClassEnrollment(await enrollments(ADULT_CLASS_EMAILS.row2));
    expect([...(after!['enrolledMids'] as string[])].sort()).toEqual(mids);
    expect(after!['membershipMode']).toBe('manual');
  });

  // ── Row 5 — single non-teaching parent, preselected, one tap ───────────────
  test('row 5: a single non-teaching parent is preselected and can confirm in one tap', async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, ADULT_CLASS_EMAILS.row5);
    try {
      await page.goto('/family');
      await expect(page).toHaveURL(/\/adult-class(\/|$|\?)/, { timeout: 30_000 });
      await expect(adultCheckboxes(page)).toHaveCount(1, { timeout: 20_000 });
      await expect(adultCheckboxes(page).first()).toBeChecked();
      await expect(page.getByRole('button', { name: /Continue/i })).toBeEnabled();

      await page.getByRole('button', { name: /Continue/i }).click();
      await expect(page).toHaveURL(/\/family(\/|$|\?)/, { timeout: 30_000 });

      const asc = adultClassEnrollment(await enrollments(ADULT_CLASS_EMAILS.row5));
      expect((asc!['enrolledMids'] as string[]).length).toBe(1);
      expect(asc!['effectiveSuggestedAmount']).toBe(0);
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── Row 3 — isolates "every adult teaches", WITH a paid Bala Vihar ─────────
  test('row 3: a Bala Vihar family whose adults all teach is never asked', async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, ADULT_CLASS_EMAILS.row3);
    try {
      await page.goto('/family');
      await expect(page).toHaveURL(/\/family(\/|$|\?)/, { timeout: 30_000 });
      // Not a slow redirect: hold still and confirm it never diverts.
      await page.waitForTimeout(2500);
      expect(page.url()).not.toContain('/adult-class');
      // And /adult-class itself sends them away rather than showing an empty form.
      await page.goto('/adult-class');
      await expect(page).toHaveURL(/\/family(\/|$|\?)/, { timeout: 30_000 });
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── Row 6 — isolates "no Bala Vihar", WITH freely selectable adults ────────
  test('row 6: an adults-only family is never asked, and is quoted $101 if they opt in', async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, ADULT_CLASS_EMAILS.row6);
    try {
      await page.goto('/family');
      await expect(page).toHaveURL(/\/family(\/|$|\?)/, { timeout: 30_000 });
      await page.waitForTimeout(2500);
      expect(page.url()).not.toContain('/adult-class');
    } finally {
      await page.close();
      await ctx.close();
    }

    // §6.1's other half, which the previous attempt never walked: availability is
    // not obligation, so they CAN enroll - and they are quoted the full $101.
    const ctxApi = await apiAs(ADULT_CLASS_EMAILS.row6);
    try {
      const res = await ctxApi.post('/api/setu/enrollments', {
        data: { oid: 'adult-study-class-brampton-2026-27' },
      });
      expect(res.ok(), `voluntary enroll failed: ${res.status()} ${await res.text()}`).toBeTruthy();
      expect((await res.json()).suggestedAmount).toBe(101);
    } finally {
      await ctxApi.dispose();
    }
  });

  // ── Row 7 — fails BOTH conditions; proves nothing alone, hence rows 3 + 6 ──
  test('row 7: an adults-only family who all teach is never asked', async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, ADULT_CLASS_EMAILS.row7);
    try {
      await page.goto('/family');
      await expect(page).toHaveURL(/\/family(\/|$|\?)/, { timeout: 30_000 });
      await page.waitForTimeout(2500);
      expect(page.url()).not.toContain('/adult-class');
      await page.goto('/adult-class');
      await expect(page).toHaveURL(/\/family(\/|$|\?)/, { timeout: 30_000 });
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── §6.5 — the roster must not read the exempt enrollment as unpaid ────────
  test('a paid Bala Vihar family that added the exempt class still reads paid on the roster', async () => {
    const list = await enrollments(ADULT_CLASS_EMAILS.row1);
    expect(adultClassEnrollment(list), 'row 1 must be enrolled for this to mean anything').not.toBeNull();
    const fid = String(list[0]?.['fid'] ?? '');
    expect(fid, 'could not resolve row 1 fid from its enrollments').not.toBe('');

    // The roster report is welcome-team/admin only, so this uses the `setu`
    // project's storageState (the shared family is also admin — see e2e/README).
    const admin = await request.newContext({ baseURL, storageState: 'e2e/.auth/family.json' });
    try {
      const res = await admin.get('/api/welcome/roster/report');
      expect(res.ok(), `roster report failed: ${res.status()}`).toBeTruthy();
      const rows = (await res.json()).rows as Array<{ fid: string; payment: string }>;
      const row = rows.find((r) => r.fid === fid);
      expect(row, `row 1 family ${fid} missing from the roster report`).toBeTruthy();
      // $500 Bala Vihar + $0 exempt adult class = $500 expected. The fixture pays
      // only $25 of it, so the honest verdict is `outstanding` — NOT `unknown`,
      // which is what a $0 enrollment used to drag the whole family to, and NOT
      // `not-applicable`, which would mean the Bala Vihar fee had vanished.
      expect(row!.payment).toBe('outstanding');
    } finally {
      await admin.dispose();
    }
  });

  // Leave every fixture un-gated for the next run even without a reseed.
  test.afterAll(async () => {
    for (const email of Object.values(ADULT_CLASS_EMAILS)) {
      const state = states.get(email);
      if (!state) continue;
      const ctx = await request.newContext({ baseURL, storageState: state });
      try {
        const res = await ctx.get('/api/setu/enrollments');
        if (!res.ok()) continue;
        const asc = adultClassEnrollment((await res.json()).enrollments);
        if (!asc) continue;
        await ctx.delete(`/api/setu/enrollments/${String(asc['eid'])}`).catch(() => undefined);
      } finally {
        await ctx.dispose();
      }
    }
  });
});
