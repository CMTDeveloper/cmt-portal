import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Phase 4 (Reports hub): the single UAT test user is family-manager + admin, so
// it sees ALL cards (enrollment, attendance + the admin-only legacy check-in
// card). The donations report was removed (no collective financial info here).
// Read-only feature — no mutations/cleanup. Screens render mobile + desktop
// blocks both in the DOM → filter to the visible (desktop) instances.
test.describe('Phase 4 — Reports hub (/welcome/reports)', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('hub renders enrollment + attendance cards, and NO donations card', async ({ page }) => {
    await page.goto('/welcome/reports');
    await expect(page.getByTestId('report-card-enrollment').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('report-card-attendance').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
    // The donations report was removed — its card must never render.
    await expect(page.getByTestId('report-card-donations')).toHaveCount(0);
  });

  test('report APIs return JSON for the signed-in admin', async ({ page }) => {
    for (const kind of ['enrollment', 'attendance']) {
      const res = await page.request.get(`/api/welcome/reports/${kind}`, { timeout: 30_000 });
      expect(res.status(), kind).toBe(200);
      // each report is a JSON object (not an error)
      const body = await res.json();
      expect(typeof body, kind).toBe('object');
    }
  });

  test('report CSV exports return text/csv', async ({ page }) => {
    for (const kind of ['enrollment', 'attendance']) {
      const res = await page.request.get(`/api/welcome/reports/${kind}?format=csv`, { timeout: 30_000 });
      expect(res.status(), kind).toBe(200);
      expect(res.headers()['content-type'], kind).toContain('text/csv');
    }
  });

  test('the removed donations kind and any unknown kind are 400', async ({ page }) => {
    for (const kind of ['donations', 'bogus']) {
      const res = await page.request.get(`/api/welcome/reports/${kind}`);
      expect(res.status(), kind).toBe(400);
    }
  });
});
