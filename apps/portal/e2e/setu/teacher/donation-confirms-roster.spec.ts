import { test, expect, type Page } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';
// STATIC, not `await import(...)`. The dynamic form dies under Playwright's
// loader with "./apps does not provide an export named getMasterApp" (#123) -
// the named exports of a TS module are not discoverable when it is pulled in at
// runtime rather than transformed at load. Every seed that used it was silently
// broken, and so was its cleanup.
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/**
 * Regression guard for `318448f` - the completed-donation confirmation signal on
 * the teacher roster, verified through the teacher UI against deployed UAT.
 *
 * THE BUG: `donations` is a TOP-LEVEL collection whose docs carry an `fid`
 * FIELD (create-donation.ts:28), so `d.ref.parent.parent` is null for every one
 * of them. roster-confirmation.ts read `d.ref.parent.parent?.id`, got
 * `undefined`, and `continue`d past EVERY donation. Measured against real UAT
 * data: 7 of 7 completed donations carry `fid`, 0 have a parent doc.
 *
 * WHY IT MATTERED, precisely: `confirmedFids` decides which BUCKET a child lands
 * in - `roster.ts:80` sends confirmed families to `members` (the Enrolled class
 * roster) and everyone else to `previousStudents` ("Not in this class yet"). So
 * a family who had DONATED but not yet ATTENDED had their children filed under
 * "not in this class" on Sunday morning. That is the ordinary early-September
 * case: families pay in August, classes start in September.
 *
 * It stayed hidden because it is self-healing - the moment a teacher marks that
 * child present, `attendedCount > 0` confirms the family from then on. Which is
 * also why the one donation-confirmable family in UAT already has an attendance
 * mark, and why a unit test could not have caught it: the pre-existing fixture
 * built donation docs with a populated parent path and NO fid field, the exact
 * inverse of the real shape.
 *
 * THE FIXTURE: `CMT-E2E-PSOLO` (scripts/seed-e2e-family.ts §6f) is a single-child
 * `enrolledVia: 'promotion'` carry-forward with no attendance, so it starts in
 * "Previous students". This spec gives it a completed donation tied to its eid -
 * making the donation its ONLY possible confirmation signal - and asserts it
 * moves onto the Enrolled roster. Before the fix it would not have moved.
 *
 * SHARED FIXTURE: this level is also driven by not-in-class.spec.ts, which
 * expects Enrolled=2 / Previous=3. The probe donation MUST be removed or that
 * spec breaks, so cleanup runs in both beforeAll and afterAll and the doc is
 * tagged `_test: true` for the integration suite's sweep. playwright.config.ts
 * pins `workers: 1`, so the two files never interleave.
 */

const LEVEL_ID = 'e2e-prev-level';
const DATE = '2026-06-07'; // the same fixed PAST Sunday not-in-class.spec.ts uses
const SOLO_FID = 'CMT-E2E-PSOLO';
const SOLO_EID = 'CMT-E2E-PSOLO-e2e-prev-period';
const PROBE_DID = 'e2e-probe-donation-confirms-psolo'; // deterministic id => precise cleanup

function visibleAttRows(page: Page) {
  return page.getByTestId('att-row').filter({ visible: true });
}

/** Read the `(N)` count out of a visible "<label> (N)" heading. */
async function countFromLabel(page: Page, re: RegExp): Promise<number> {
  const loc = page.getByText(re).filter({ visible: true }).first();
  await expect(loc).toBeVisible({ timeout: 20_000 });
  const txt = (await loc.textContent()) ?? '';
  const m = txt.match(/\((\d+)\)/);
  expect(m, `no (N) count in "${txt}"`).not.toBeNull();
  return Number(m![1]);
}

async function expandSection(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /not in this class yet/i }).filter({ visible: true }).first();
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

async function db() {
  return portalFirestore();
}

/** Remove the probe donation AND any attendance on the level, so this spec is
 *  order-independent: an attendance mark would confirm the family too and mask
 *  whether the donation did the work. */
async function resetFixture(): Promise<void> {
  const fs = await db();
  await fs.collection('donations').doc(PROBE_DID).delete();
  const snap = await fs.collection('attendanceEvents').where('levelId', '==', LEVEL_ID).get();
  for (const d of snap.docs) await d.ref.delete();
}

async function giveSoloACompletedDonation(): Promise<void> {
  const fs = await db();
  const now = new Date();
  // Written the way createDonation does: TOP-LEVEL doc, `fid` as a FIELD. That
  // is the shape the bug could not read, so it is the shape this must use.
  await fs.collection('donations').doc(PROBE_DID).set({
    _test: true,
    did: PROBE_DID,
    fid: SOLO_FID,
    donorMid: `${SOLO_FID}-01`,
    donorName: 'Psolo Parent',
    donorEmail: 'psolo@example.com',
    type: 'enrollment',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    pid: 'e2e-prev-period',
    eid: SOLO_EID, // load-bearing: isEnrollmentConfirmed matches on eid
    label: 'E2E probe donation',
    amountCAD: 200,
    coverFee: false,
    feeCAD: 0,
    clientReferenceId: PROBE_DID,
    status: 'completed',
    createdAt: now,
    updatedAt: now,
  });
}

test.describe('Teacher roster - a completed donation confirms the family', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test.beforeAll(resetFixture);
  test.afterAll(resetFixture);

  test('a donation-only family moves from "Not in this class yet" onto the Enrolled roster', async ({ page }) => {
    // ── Baseline: no donation, so Psolo is an unconfirmed carry-forward. ───────
    await page.goto(`/teacher/levels/${LEVEL_ID}/attendance?date=${DATE}`);
    await expect(
      page,
      'redirected off /teacher - set NEXT_PUBLIC_FEATURE_SETU_TEACHER=true on the target deploy',
    ).toHaveURL(new RegExp(`/teacher/levels/${LEVEL_ID}/attendance`));

    expect(await countFromLabel(page, /Enrolled students \(\d+\)/), 'baseline confirmed = Penr Alpha + Penr Bravo').toBe(2);
    await expect(visibleAttRows(page).filter({ hasText: 'Psolo Prev' })).toHaveCount(0);
    await expandSection(page);
    expect(await countFromLabel(page, /Previous students \(\d+\)/), 'baseline previous = 2 siblings + Psolo').toBe(3);
    await expect(page.getByText('Psolo Prev').filter({ visible: true })).toHaveCount(1);

    // ── The only thing that changes is one completed donation. ─────────────────
    // No attendance is written, and enrolledVia stays 'promotion', so the
    // donation is the ONLY signal that can confirm this family. Written straight
    // to Firestore rather than through the donate flow because the point under
    // test is the READ (how roster-confirmation resolves the doc's fid), and the
    // teacher page has no `use cache` in its chain, so the next load is fresh.
    await giveSoloACompletedDonation();

    // ── After: Psolo is confirmed, so its child joins the Enrolled roster. ─────
    await page.goto(`/teacher/levels/${LEVEL_ID}/attendance?date=${DATE}`);
    expect(
      await countFromLabel(page, /Enrolled students \(\d+\)/),
      'Enrolled 2 -> 3: the donation confirmed CMT-E2E-PSOLO. Before 318448f the fid resolved undefined and every donation was skipped, so this stayed 2.',
    ).toBe(3);
    await expect(visibleAttRows(page).filter({ hasText: 'Psolo Prev' })).toHaveCount(1);

    await expandSection(page);
    expect(await countFromLabel(page, /Previous students \(\d+\)/), 'Previous 3 -> 2 (only the PSIB siblings remain)').toBe(2);
    // Deliberately NOT asserting that "Psolo Prev" is gone from the page: it
    // MOVED, it did not disappear, so the name is now on an Enrolled att-row.
    // The pair above is the complete proof of the move - the att-row assertion
    // says it is on the roster, the count says it left the previous group.
  });
});
