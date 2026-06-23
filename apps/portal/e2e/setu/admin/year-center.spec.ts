import { test, expect } from '@playwright/test';
import { hasFamilyCreds, visibleText } from '../../_helpers';

// Non-destructive Year-center E2E. Activate flips the GLOBAL live school year, so
// this spec deliberately never runs Start/Promote/Activate/Copy-calendar — it
// asserts the deployed surface + the Activate gate against whatever the current
// shared UAT state is (mirrors school-year-config.spec's "never disrupt shared
// config" discipline). The flip happy-path is covered by the Task-6 unit tests.
test.describe('Admin — Year center', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('GET /api/admin/school-year returns config + nextYear + readiness', async ({ page }) => {
    const res = await page.request.get('/api/admin/school-year');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.config.currentYear).toMatch(/^\d{4}-\d{2}$/);
    expect(body.nextYear).toMatch(/^\d{4}-\d{2}$/);
    expect(body.readiness).toBeTruthy();
    expect(body.readiness.toYear).toBe(body.nextYear);
    for (const k of ['promotionRan', 'offerings', 'levels', 'calendar', 'teachers', 'prasad', 'seva']) {
      expect(typeof body.readiness[k]).toBe('boolean');
    }
  });

  test('/admin/school-year renders the live-year badge + readiness checklist + Activate gate', async ({ page }) => {
    // Read readiness first so the Activate-state assertion is robust to whatever
    // the current UAT state is (pre- vs post-promotion).
    const body = await (await page.request.get('/api/admin/school-year')).json();
    const promotionRan: boolean = body.readiness.promotionRan;
    const nextYear: string = body.nextYear;
    const currentYear: string = body.config.currentYear;

    await page.goto('/admin/school-year');
    await expect(
      page.getByRole('heading', { name: /school year rollover/i }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 20_000 });

    // Live-year badge in the admin chrome.
    await expect(visibleText(page, new RegExp(`School year ${currentYear}`)).first()).toBeVisible();

    // Step 3 readiness checklist — the six item labels.
    for (const label of ['Offerings', 'Levels', 'Class calendar', 'Teachers', 'Prasad', 'Seva']) {
      await expect(visibleText(page, label).first()).toBeVisible();
    }

    // Activate button + gate. Robust to UAT state: disabled (+ helper) iff promotion hasn't run.
    const activate = page.getByRole('button', { name: new RegExp(`Activate ${nextYear}`, 'i') }).filter({ visible: true }).first();
    await expect(activate).toBeVisible();
    if (promotionRan) {
      await expect(activate).toBeEnabled();
    } else {
      await expect(activate).toBeDisabled();
      await expect(visibleText(page, /Promote families before activating/i).first()).toBeVisible();
    }
    // Deliberately NO clicks on Start/Promote/Activate/Copy — non-destructive.
  });
});
