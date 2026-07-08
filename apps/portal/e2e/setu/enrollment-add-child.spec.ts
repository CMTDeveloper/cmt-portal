import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, request as apiRequest } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';
import { signInFamilyAndSaveStorage } from '../auth-helpers';

/**
 * E2E for the enrollment auto-sync fix (the N=2 dashboard bug), verified against
 * deployed UAT. `enrolledMids` is a denormalized snapshot frozen at enroll time;
 * before the fix a child added AFTER the family enrolled was never swept into the
 * active enrollment, so the family dashboard's Bala Vihar section silently omitted
 * them (while the enroll page misleadingly showed them "enrolling"). The fix:
 * every member add/edit/delete now reconciles active-enrollment `enrolledMids`
 * to the family's currently-eligible members.
 *
 * This spec exercises the exact user path: an ALREADY-ENROLLED family (the seed's
 * one child + active 2026-27 BV enrollment) adds a SECOND eligible child via the
 * real `POST /api/setu/members` (carrying the manager session), then the dashboard
 * must list BOTH children in the Bala Vihar section. It cleans up the added child
 * in afterAll (the seed reuses the existing family and does NOT prune extras).
 *
 * SHARED-FIXTURE NOTE: like dashboard-slice1 / enrollment-state, this reseeds the
 * ONE E2E family — run it in its own invocation, not alongside those specs, or the
 * reseeds race. Two password sign-ins per run (beforeAll reauth + afterAll
 * cleanup), well under the 5-per-15-min limiter.
 */

function reseedE2eFamily(flags: string[] = []): void {
  const suffix = flags.length ? ` -- ${flags.join(' ')}` : '';
  execSync(`pnpm --filter @cmt/portal seed:e2e-family${suffix}`, {
    cwd: resolve(process.cwd(), '..', '..'),
    stdio: 'inherit',
    timeout: 120_000,
  });
}

/** Re-establish the E2E family session after the reseed bumps tokensValidAfterTime. */
async function reauthE2eFamily(): Promise<void> {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
  const ctx = await apiRequest.newContext({ baseURL });
  try {
    await signInFamilyAndSaveStorage(ctx);
  } finally {
    await ctx.dispose();
  }
}

// Distinctive name so the BV-section assertion can't false-match the seed's
// baseline child ("E2E Child").
const ADDED_FIRST = 'Zephyrina';
const ADDED_LAST = 'SyncTest';

test.describe.serial('Enrollment auto-sync — child added after enrollment', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required (run seed:e2e-family first)');

  let addedMid: string | null = null;

  test.beforeAll(async () => {
    reseedE2eFamily(['--enrolled-via', 'family-initiated']);
    await reauthE2eFamily();
  });

  test.afterAll(async () => {
    if (!addedMid) return;
    // Remove the added child via a freshly-authenticated context so the fixture
    // returns to its one-child baseline (the seed does not prune extra members).
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
    const ctx = await apiRequest.newContext({ baseURL });
    try {
      await signInFamilyAndSaveStorage(ctx);
      await ctx.delete(`/api/setu/members/${addedMid}`);
    } finally {
      await ctx.dispose();
    }
  });

  test('a second child added after enrollment appears in the Bala Vihar section', async ({ page }) => {
    // Baseline: the freshly-seeded family shows its one BV child, not ours yet.
    await page.goto('/family');
    await expect(visibleText(page, 'Bala Vihar').first()).toBeVisible();
    await expect(page.getByText(ADDED_FIRST)).toHaveCount(0);

    // Add a second eligible Child through the real route (the page's request
    // carries the manager __session cookie → middleware injects role/fid).
    const res = await page.request.post('/api/setu/members', {
      data: {
        firstName: ADDED_FIRST,
        lastName: ADDED_LAST,
        type: 'Child',
        gender: 'Female',
        foodAllergies: 'None',
        schoolGrade: 'Grade 2',
        birthMonthYear: '2018-04',
      },
    });
    expect(res.status()).toBe(201);
    addedMid = ((await res.json()) as { mid: string }).mid;

    // The add-member route reconciled the active BV enrollment's enrolledMids, so
    // the dashboard's Bala Vihar CHILDREN list now includes the new child. (The
    // route revalidates the family cache tag, so the fresh load sees them.)
    await page.goto('/family');
    await expect(visibleText(page, ADDED_FIRST).first()).toBeVisible();
  });
});
