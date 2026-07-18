import { test, expect, type Page } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Teacher attendance - the consolidated "Not in this class yet" section, deployed
// UAT. Previous students + Registered-not-enrolled are merged into ONE inline
// collapsible on the attendance page (Vaibhav: one list, not several); the old
// /previous page now redirects here.
//
// The single seeded UAT user is family-manager + admin; admin inherits teacher
// capability, so the shared family.json session reaches any level. The target is
// the dedicated split fixture on level `e2e-prev-level` (scripts/seed-e2e-family.ts
// §6f - a DEDICATED Brampton level so this spec's confirm mutation never collides
// with attendance-binary.spec.ts under the parallel runner):
//   - Enrolled (confirmed): Penr Alpha + Penr Bravo (2).
//   - Previous (unconfirmed carry-forwards): Psib Threegrade + Psib Fourgrade (one
//     TWO-SIBLING family CMT-E2E-PSIB) + Psolo Prev (CMT-E2E-PSOLO) = 3.
//
// The teacher layout dual-renders (mobile + desktop), so locators use
// `.filter({ visible: true })` to key off the single visible (desktop) copy.

const LEVEL_ID = 'e2e-prev-level';
const DATE = '2026-06-07'; // a fixed PAST Sunday so the roster is never future.

const SIB_FID = 'CMT-E2E-PSIB';
const SIB_CHILD_2_MID = `${SIB_FID}-03`; // Psib Fourgrade
const SOLO_MID = 'CMT-E2E-PSOLO-02'; // Psolo Prev - must REMAIN after the confirm

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

/** Expand the "Not in this class yet" section (idempotent-ish: only clicks when collapsed). */
async function expandSection(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /not in this class yet/i }).filter({ visible: true }).first();
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

async function resetLevelAttendance(): Promise<void> {
  const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
  const db = portalFirestore();
  const snap = await db.collection('attendanceEvents').where('levelId', '==', LEVEL_ID).get();
  for (const d of snap.docs) await d.ref.delete();
}

test.describe('Teacher - consolidated "Not in this class yet" section', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test.beforeAll(resetLevelAttendance);
  test.afterAll(resetLevelAttendance);

  test('previous students confirm inline; the registered-not-enrolled group loads; remaining previous never auto-absented', async ({ page }) => {
    // ── (a) Enrolled roster is only the confirmed students. ────────────────────
    await page.goto(`/teacher/levels/${LEVEL_ID}/attendance?date=${DATE}`);
    await expect(
      page,
      'redirected off /teacher - set NEXT_PUBLIC_FEATURE_SETU_TEACHER=true on the target deploy',
    ).toHaveURL(new RegExp(`/teacher/levels/${LEVEL_ID}/attendance`));

    expect(await countFromLabel(page, /Enrolled students \(\d+\)/), 'confirmed = Penr Alpha + Penr Bravo').toBe(2);
    await expect(visibleAttRows(page)).toHaveCount(2, { timeout: 20_000 });
    // Previous students are NOT on the Enrolled roster.
    await expect(visibleAttRows(page).filter({ hasText: 'Psib Threegrade' })).toHaveCount(0);
    await expect(visibleAttRows(page).filter({ hasText: 'Psolo Prev' })).toHaveCount(0);

    // ── (b) Expand the consolidated section. The registered group fires its
    //        lazy GET (proves the index-free location scan works on real UAT
    //        data); the Previous group renders the 3 carry-forwards inline. ─────
    const [eligibleResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/setu/teacher/grade-eligible') && r.request().method() === 'GET',
        { timeout: 30_000 },
      ),
      expandSection(page),
    ]);
    expect(eligibleResp.status(), await eligibleResp.text()).toBe(200);
    await expect(page.getByText(/Registered · not enrolled/i).filter({ visible: true }).first()).toBeVisible();

    expect(await countFromLabel(page, /Previous students \(\d+\)/), 'previous = 2 siblings + 1 single').toBe(3);
    for (const name of ['Psib Threegrade', 'Psib Fourgrade', 'Psolo Prev']) {
      await expect(page.getByText(name).filter({ visible: true })).toHaveCount(1);
    }

    // ── (c) Mark present on ONE sibling → confirm-previous → both siblings drop
    //        (siblings confirm together); the single previous student remains. ──
    const sibCard = page.locator('.card').filter({ hasText: 'Psib Threegrade' }).filter({ visible: true }).first();
    const [confirmResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/setu/teacher/attendance/confirm-previous') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      sibCard.getByRole('button', { name: /mark present/i }).click(),
    ]);
    expect(confirmResp.status(), await confirmResp.text()).toBe(200);

    await expect(page.getByText(/added to this year.s class/i).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Psib Threegrade').filter({ visible: true })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('Psib Fourgrade').filter({ visible: true })).toHaveCount(0);
    await expect(page.getByText('Psolo Prev').filter({ visible: true })).toHaveCount(1);
    expect(await countFromLabel(page, /Previous students \(\d+\)/)).toBe(1);

    // ── (c2) LIVE (no reload): the confirmed student joins the Enrolled roster and
    //        shows Present immediately via router.refresh. Regression guard — the
    //        marker must RE-SEED the fresh rows, else a just-marked child stays
    //        Unmarked until a hard page reload (Vaibhav). ─────────────────────────
    const liveRow = visibleAttRows(page).filter({ hasText: 'Psib Threegrade' }).first();
    await expect(liveRow).toHaveCount(1, { timeout: 15_000 });
    await expect(liveRow).toHaveAttribute('aria-pressed', 'true');

    // ── (d) Reload: the confirmed family joins the Enrolled roster (+2); the
    //        section's Previous group drops to 1. ────────────────────────────────
    await page.goto(`/teacher/levels/${LEVEL_ID}/attendance?date=${DATE}`);
    await expect(visibleAttRows(page)).toHaveCount(4, { timeout: 20_000 });
    expect(await countFromLabel(page, /Enrolled students \(\d+\)/), 'Enrolled 2 -> 4 (both CMT-E2E-PSIB siblings)').toBe(4);
    const markedRow = visibleAttRows(page).filter({ hasText: 'Psib Threegrade' }).first();
    await expect(markedRow).toHaveAttribute('aria-pressed', 'true');
    await expandSection(page);
    expect(await countFromLabel(page, /Previous students \(\d+\)/), 'Previous 3 -> 1 (only Psolo Prev)').toBe(1);

    // ── (e) A normal Enrolled-roster save sweeps unmarked CONFIRMED students to
    //        Absent but NEVER touches previous students. Tap Penr Alpha so the
    //        autosave fires the whole confirmed roster. ─────────────────────────
    const enrAlphaRow = visibleAttRows(page).filter({ hasText: 'Penr Alpha' }).first();
    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/setu/teacher/attendance') &&
          !r.url().includes('confirm-previous') &&
          !r.url().includes('grade-eligible') &&
          r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      enrAlphaRow.click(),
    ]);
    expect(saveResp.status(), await saveResp.text()).toBe(200);

    const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
    const db = portalFirestore();
    // Psolo Prev (previous) - no attendance event written for this date.
    const prevDoc = await db.collection('attendanceEvents').doc(`${LEVEL_ID}-${SOLO_MID}-${DATE}`).get();
    expect(prevDoc.exists, 'remaining previous student must NOT be auto-absented by the roster save').toBe(false);
    // Psib Fourgrade (confirmed, unmarked) - DID get swept Absent (proves the sweep ran).
    const sibFourDoc = await db.collection('attendanceEvents').doc(`${LEVEL_ID}-${SIB_CHILD_2_MID}-${DATE}`).get();
    expect(sibFourDoc.exists, 'confirmed unmarked student SHOULD be swept Absent').toBe(true);
    expect((sibFourDoc.data() as { status?: string } | undefined)?.status).toBe('absent');
  });
});
