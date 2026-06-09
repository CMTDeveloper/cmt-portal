import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Rollover "Set grade": admins can fix a child's missing grade (the rollover
// blocker) inline on /admin/school-year OR from the welcome member detail page,
// both writing through POST /api/admin/school-year/set-grade (admin-only).
// The single seeded UAT user is family-manager + admin. The endpoint round-trip
// MUTATES the seed child's grade, so it reverts to the seed value ('Grade 4' →
// ladder '4'); a re-seed restores it regardless.
const FID = 'CMT-FSWEDU2X';
const CHILD_MID = 'CMT-FSWEDU2X-02';

test.describe('Rollover — admin set grade', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('set-grade endpoint: round-trip + validation (admin)', async ({ page }) => {
    // valid set → 200, then revert to the seed-equivalent grade → 200
    const set = await page.request.post('/api/admin/school-year/set-grade', {
      data: { fid: FID, mid: CHILD_MID, schoolGrade: '5' },
    });
    expect(set.status()).toBe(200);
    expect((await set.json()).ok).toBe(true);

    const revert = await page.request.post('/api/admin/school-year/set-grade', {
      data: { fid: FID, mid: CHILD_MID, schoolGrade: '4' },
    });
    expect(revert.status()).toBe(200);

    // off-ladder grade → 400 (no mutation)
    const bad = await page.request.post('/api/admin/school-year/set-grade', {
      data: { fid: FID, mid: CHILD_MID, schoolGrade: '13' },
    });
    expect(bad.status()).toBe(400);

    // unknown member → 404
    const missing = await page.request.post('/api/admin/school-year/set-grade', {
      data: { fid: FID, mid: 'CMT-FSWEDU2X-nope', schoolGrade: '5' },
    });
    expect(missing.status()).toBe(404);
  });

  test('welcome member detail shows the admin grade editor', async ({ page }) => {
    await page.goto(`/welcome/family/${FID}/members/${CHILD_MID}`);
    // The editor's label is a styled <p> (not a heading) + a grade <select>
    // whose aria-label is "Grade for {child}". Assert both visible.
    await expect(
      page.getByText(/admin · set grade/i).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByLabel(/grade for/i).filter({ visible: true }).first(),
    ).toBeVisible();
  });

  test('rollover screen renders the inline Set grade control on need-attention rows', async ({ page }) => {
    await page.goto('/admin/school-year');
    // Step 2 (Promote families) renders; the "Need attention" disclosure is open
    // by default. If UAT currently has need-attention children, each row carries
    // an inline grade control. Assert it when present; skip cleanly if the roster
    // has none (the count varies as grades get fixed).
    await expect(page.getByRole('heading', { name: /promote families/i }).filter({ visible: true }).first())
      .toBeVisible({ timeout: 20_000 });
    const controls = page.getByLabel(/^set grade for/i).filter({ visible: true });
    const n = await controls.count();
    if (n > 0) {
      await expect(controls.first()).toBeVisible();
    } else {
      test.info().annotations.push({ type: 'note', description: 'No need-attention rows in UAT — inline control not asserted.' });
    }
  });
});
