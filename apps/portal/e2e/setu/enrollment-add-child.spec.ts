import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, request as apiRequest } from '@playwright/test';
import {
  E2E_BASE_URL,
  visibleText,
  hasFamilyCreds,
  hasTestAccounts,
  TEST_ACCOUNTS_PASSWORD,
  TEST_ACCOUNT_EMAILS,
} from '../_helpers';
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
 * reseeds race. Password sign-ins per run: two on the family account (auth.setup
 * + the beforeAll reauth) and one on the admin account (the afterAll cleanup,
 * which goes through the staff route). The limiter is per-email, so each is well
 * under 5 per 15 minutes.
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
  const baseURL = E2E_BASE_URL;
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
  // The afterAll cleanup deletes through the ADMIN route, so without the staff
  // password this spec would add a child to the shared fixture and leave it.
  test.skip(!hasTestAccounts, 'TEST_ACCOUNTS_PASSWORD required for the admin-route cleanup');

  let addedMid: string | null = null;
  // Captured rather than derived from the mid. A mid looks like `{fid}-03`, so
  // slicing at the last dash would work today and would be a silent trap the
  // day an id format changes - and the cleanup it feeds is a DELETE.
  let familyFid: string | null = null;

  test.beforeAll(async () => {
    reseedE2eFamily(['--enrolled-via', 'family-initiated']);
    await reauthE2eFamily();
  });

  test.afterAll(async () => {
    if (!addedMid || !familyFid) return;
    // Remove the added child so the fixture returns to its one-child baseline
    // (the seed does not prune extra members).
    //
    // Through the ADMIN route, and as an ADMIN: `DELETE /api/setu/members/{mid}`
    // was closed to families on 2026-08-04, so the family-session call this used
    // to make now 403s. It had no assertion on the response, so it would have
    // gone on "succeeding" silently while every run left another orphaned
    // "Zephyrina SyncTest" in the shared preview fixture forever. Found by Codex
    // review, not by a failing test - which is the argument for the assertion
    // below.
    //
    // The limiter is keyed on the normalized email, so this costs the ADMIN
    // account one sign-in and the family none - the family's two (auth.setup +
    // the beforeAll reauth) are unchanged. Both well under 5 per 15 minutes.
    const ctx = await apiRequest.newContext({ baseURL: E2E_BASE_URL });
    try {
      const signIn = await ctx.post('/api/setu/auth/password-sign-in', {
        data: { email: TEST_ACCOUNT_EMAILS.admin, password: TEST_ACCOUNTS_PASSWORD },
      });
      expect(signIn.ok(), `admin sign-in for cleanup failed: ${signIn.status()}`).toBeTruthy();

      const res = await ctx.delete(
        `/api/welcome/families/${familyFid}/members/${addedMid}`,
      );
      // Asserted, so a cleanup that stops working says so instead of quietly
      // accumulating members in a fixture every other spec shares.
      expect(res.ok(), `cleanup delete failed: ${res.status()} ${await res.text()}`).toBeTruthy();
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

    // The fid, for the admin-route cleanup in afterAll.
    const famRes = await page.request.get('/api/setu/family');
    expect(famRes.ok()).toBeTruthy();
    familyFid = ((await famRes.json()) as { family: { fid: string } }).family.fid;

    // The add-member route reconciled the active BV enrollment's enrolledMids, so
    // the dashboard's Bala Vihar CHILDREN list now includes the new child. (The
    // route revalidates the family cache tag, so the fresh load sees them.)
    await page.goto('/family');
    await expect(visibleText(page, ADDED_FIRST).first()).toBeVisible();

    // …and the child's level is DERIVED LIVE from their grade — a self-enrolled
    // child has no rollover levelSnapshot, so without the fallback it would read
    // "Level pending". Grade 2 → Brampton Level 2 (band 2 & 3). The seed's
    // baseline child (Grade 4) maps to Level 3, so "Level 2" is uniquely ours.
    await expect(visibleText(page, /^Level 2$/).first()).toBeVisible();
  });
});
