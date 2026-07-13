import { test, expect, type Page } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Teacher attendance - Enrolled vs Previous students split, deployed UAT.
// The single seeded UAT user is family-manager + admin; admin inherits teacher
// capability (isTeacher(admin) -> true, canTeachLevel(admin) -> 'ok'), so the
// shared family.json session reaches any level. The target is the dedicated,
// isolated `_test` split fixture the seed provisions on level `e2e-prev-level`
// (scripts/seed-e2e-family.ts §6f - a DEDICATED level so this spec's confirm
// mutation never collides with attendance-binary.spec.ts under the parallel runner):
//   - Enrolled (confirmed) roster: Penr Alpha + Penr Bravo (2, across 2
//     family-initiated families).
//   - Previous (active-but-unconfirmed carry-forwards): Psib Threegrade + Psib
//     Fourgrade (one TWO-SIBLING family, CMT-E2E-PSIB) + Psolo Prev (single,
//     CMT-E2E-PSOLO) = 3.
//
// The `/teacher/*` surface is gated behind NEXT_PUBLIC_FEATURE_SETU_TEACHER=true
// (middleware) - off, the page redirects to /family, which the URL assertion
// surfaces. The flag is on in UAT.
//
// The teacher layout renders its children TWICE (mobile `.block md:hidden` +
// desktop `.hidden md:flex`), so every text/testid locator is `.filter({ visible:
// true })` to key off the single visible (desktop) copy on Desktop Chrome.

const LEVEL_ID = 'e2e-prev-level';
// A fixed PAST Sunday (June 7, 2026 is a Sunday) so the roster is never in the
// future (which hides it) and confirm + save + reload all target the same date.
const DATE = '2026-06-07';

// Fixture ids seeded by scripts/seed-e2e-family.ts §6f.
const SIB_FID = 'CMT-E2E-PSIB'; // two-sibling PREVIOUS family
const SIB_CHILD_2_MID = `${SIB_FID}-03`; // Psib Fourgrade - confirmed-but-unmarked after the confirm
const SOLO_MID = 'CMT-E2E-PSOLO-02'; // Psolo Prev - the previous student that must REMAIN

// Attendance rows + list rows are duplicated by the layout; the visible copy is
// the desktop one on Desktop Chrome.
function visibleAttRows(page: Page) {
  return page.getByTestId('att-row').filter({ visible: true });
}

/** Read the `(N)` count out of a visible "<label> (N)" heading/link. */
async function countFromLabel(page: Page, re: RegExp): Promise<number> {
  const loc = page.getByText(re).filter({ visible: true }).first();
  await expect(loc).toBeVisible({ timeout: 20_000 });
  const txt = (await loc.textContent()) ?? '';
  const m = txt.match(/\((\d+)\)/);
  expect(m, `no (N) count in "${txt}"`).not.toBeNull();
  return Number(m![1]);
}

/** Delete every attendanceEvent on the split level so a re-run starts clean
 *  (mirrors the seed's §6d reset; playwright.config loads .env.local creds). */
async function resetLevelAttendance(): Promise<void> {
  const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
  const db = portalFirestore();
  const snap = await db.collection('attendanceEvents').where('levelId', '==', LEVEL_ID).get();
  for (const d of snap.docs) await d.ref.delete();
}

test.describe('Teacher - Enrolled vs Previous students', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  // Clean slate regardless of what the binary-attendance spec left on this level,
  // so the confirmed/previous split is deterministic.
  test.beforeAll(resetLevelAttendance);
  // Restore the seeded "unmarked" ground state so re-runs are idempotent.
  test.afterAll(resetLevelAttendance);

  test('confirm one previous student → whole family moves to Enrolled; remaining previous never auto-absented', async ({ page }) => {
    // ── (a) Attendance page: Enrolled roster is only the confirmed students, with
    //        a "Previous students (M)" entry point for the carry-forwards. ───────
    await page.goto(`/teacher/levels/${LEVEL_ID}/attendance?date=${DATE}`);
    await expect(
      page,
      'redirected off /teacher - set NEXT_PUBLIC_FEATURE_SETU_TEACHER=true on the target deploy',
    ).toHaveURL(new RegExp(`/teacher/levels/${LEVEL_ID}/attendance`));

    const enrolledCount = await countFromLabel(page, /Enrolled students \(\d+\)/);
    expect(enrolledCount, 'confirmed roster = Penr Alpha + Penr Bravo').toBe(2);
    await expect(visibleAttRows(page)).toHaveCount(2, { timeout: 20_000 });
    await expect(visibleAttRows(page).filter({ hasText: 'Penr Alpha' })).toHaveCount(1);
    await expect(visibleAttRows(page).filter({ hasText: 'Penr Bravo' })).toHaveCount(1);
    // Previous students are NOT on the Enrolled roster.
    await expect(visibleAttRows(page).filter({ hasText: 'Psib Threegrade' })).toHaveCount(0);
    await expect(visibleAttRows(page).filter({ hasText: 'Psolo Prev' })).toHaveCount(0);

    const previousBtn = page.getByRole('link', { name: /Previous students \(\d+\)/ }).filter({ visible: true }).first();
    await expect(previousBtn).toBeVisible();
    expect(await countFromLabel(page, /Previous students \(\d+\)/), 'previous = 2 siblings + 1 single').toBe(3);

    // ── (b) Previous page lists the carry-forwards, both siblings present. ──────
    await previousBtn.click();
    await expect(page).toHaveURL(new RegExp(`/teacher/levels/${LEVEL_ID}/previous`));
    expect(await countFromLabel(page, /Returning students \(\d+\)/)).toBe(3);
    for (const name of ['Psib Threegrade', 'Psib Fourgrade', 'Psolo Prev']) {
      await expect(page.getByText(name).filter({ visible: true })).toHaveCount(1);
    }

    // ── (c) Mark present on ONE sibling → success toast + both siblings drop
    //        (optimistic, siblings confirm together); the single remains. ────────
    const attSiblingRow = page.locator('.card').filter({ hasText: 'Psib Threegrade' }).filter({ visible: true }).first();
    const [confirmResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/setu/teacher/attendance/confirm-previous') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      attSiblingRow.getByRole('button', { name: /mark present/i }).click(),
    ]);
    expect(confirmResp.status(), await confirmResp.text()).toBe(200);

    await expect(page.getByText(/added to this year.s class/i).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
    // Both siblings of the confirmed family vanish; Psolo Prev stays.
    await expect(page.getByText('Psib Threegrade').filter({ visible: true })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('Psib Fourgrade').filter({ visible: true })).toHaveCount(0);
    await expect(page.getByText('Psolo Prev').filter({ visible: true })).toHaveCount(1);
    expect(await countFromLabel(page, /Returning students \(\d+\)/)).toBe(1);

    // ── (d) Reload attendance: the confirmed family joins the Enrolled roster
    //        (marked sibling present), Enrolled +2, Previous -2. ────────────────
    await page.goto(`/teacher/levels/${LEVEL_ID}/attendance?date=${DATE}`);
    await expect(visibleAttRows(page)).toHaveCount(4, { timeout: 20_000 });
    expect(await countFromLabel(page, /Enrolled students \(\d+\)/), 'Enrolled 2 -> 4 (both CMT-E2E-PSIB siblings)').toBe(4);
    // The marked sibling is now on the Enrolled roster AND seeded present.
    const markedRow = visibleAttRows(page).filter({ hasText: 'Psib Threegrade' }).first();
    await expect(markedRow).toHaveCount(1);
    await expect(markedRow).toHaveAttribute('aria-pressed', 'true');
    expect(await countFromLabel(page, /Previous students \(\d+\)/), 'Previous 3 -> 1 (only Psolo Prev)').toBe(1);

    // ── (e) A normal save on the Enrolled roster sweeps unmarked CONFIRMED
    //        students to Absent, but NEVER touches previous students. Tap one
    //        unmarked confirmed row (Penr Alpha) so the autosave fires with
    //        the whole confirmed roster; Psib Fourgrade (confirmed, still unmarked)
    //        is swept Absent, Psolo Prev (previous) gets no event at all. ─────────
    const enrAlphaRow = visibleAttRows(page).filter({ hasText: 'Penr Alpha' }).first();
    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/setu/teacher/attendance') &&
          !r.url().includes('confirm-previous') &&
          r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      enrAlphaRow.click(),
    ]);
    expect(saveResp.status(), await saveResp.text()).toBe(200);

    const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
    const db = portalFirestore();
    // Psolo Prev (previous) - no attendance event written for this date.
    const prevAid = `${LEVEL_ID}-${SOLO_MID}-${DATE}`;
    const prevDoc = await db.collection('attendanceEvents').doc(prevAid).get();
    expect(prevDoc.exists, 'remaining previous student must NOT be auto-absented by the roster save').toBe(false);
    // Psib Fourgrade (confirmed, unmarked) - DID get swept Absent, proving the
    // sweep ran (so the previous no-event above is meaningful, not a no-op save).
    const sibFourAid = `${LEVEL_ID}-${SIB_CHILD_2_MID}-${DATE}`;
    const sibFourDoc = await db.collection('attendanceEvents').doc(sibFourAid).get();
    expect(sibFourDoc.exists, 'confirmed unmarked student SHOULD be swept Absent').toBe(true);
    expect((sibFourDoc.data() as { status?: string } | undefined)?.status).toBe('absent');
  });
});
