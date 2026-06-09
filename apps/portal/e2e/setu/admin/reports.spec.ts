import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Phase 4 (Reports hub): the single UAT test user is family-manager + admin, so
// it sees ALL cards (incl. the admin-only donations + legacy check-in cards).
// Read-only feature — no mutations/cleanup. Screens render mobile + desktop
// blocks both in the DOM → filter to the visible (desktop) instances. The
// welcome-team-DENIED-donations path is covered by the route unit test
// (no welcome-team-only seeded user exists for the browser).
test.describe('Phase 4 — Reports hub (/welcome/reports)', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('hub renders enrollment + attendance + donations cards for an admin', async ({ page }) => {
    await page.goto('/welcome/reports');
    await expect(page.getByTestId('report-card-enrollment').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('report-card-attendance').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
    // The seeded test user is admin → the admin-only donations card is present.
    await expect(page.getByTestId('report-card-donations').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('report APIs return JSON for the signed-in admin', async ({ page }) => {
    for (const kind of ['enrollment', 'attendance', 'donations']) {
      const res = await page.request.get(`/api/welcome/reports/${kind}`, { timeout: 30_000 });
      expect(res.status(), kind).toBe(200);
      // each report is a JSON object (not an error)
      const body = await res.json();
      expect(typeof body, kind).toBe('object');
    }
  });

  test('report CSV exports return text/csv', async ({ page }) => {
    for (const kind of ['enrollment', 'attendance', 'donations']) {
      const res = await page.request.get(`/api/welcome/reports/${kind}?format=csv`, { timeout: 30_000 });
      expect(res.status(), kind).toBe(200);
      expect(res.headers()['content-type'], kind).toContain('text/csv');
    }
  });

  test('unknown report kind is 400', async ({ page }) => {
    const res = await page.request.get('/api/welcome/reports/bogus');
    expect(res.status()).toBe(400);
  });
});
