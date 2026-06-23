import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// App-managed current school year: admins set the current school year in
// app_config/school_year via GET/PUT /api/admin/school-year (admin-only). The
// value drives prasad period resolution + rollover defaults so the old
// per-rollover CURRENT_PRASAD_PIDS / DEFAULT_TO_YEAR code bump is gone. The
// single seeded UAT user is family-manager + admin. The PUT round-trip writes
// the CURRENT value straight back so it never disrupts the shared UAT config.
test.describe('Admin — school-year config', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('GET returns the config + derived next year; PUT round-trips and validates', async ({ page }) => {
    const get = await page.request.get('/api/admin/school-year');
    expect(get.status()).toBe(200);
    const body = await get.json();
    // currentYear is a YYYY-YY label; nextYear advances it by one.
    expect(body.config.currentYear).toMatch(/^\d{4}-\d{2}$/);
    expect(body.nextYear).toMatch(/^\d{4}-\d{2}$/);
    expect(body.nextYear).not.toBe(body.config.currentYear);

    // Idempotent write-back: PUT the current value → 200 (no UAT disruption).
    const put = await page.request.put('/api/admin/school-year', {
      data: { currentYear: body.config.currentYear },
    });
    expect(put.status()).toBe(200);
    expect((await put.json()).config.currentYear).toBe(body.config.currentYear);

    // Malformed year → 400 (no mutation).
    const bad = await page.request.put('/api/admin/school-year', {
      data: { currentYear: 'not-a-year' },
    });
    expect(bad.status()).toBe(400);
  });

  test('/admin/school-year renders the current-year editor', async ({ page }) => {
    await page.goto('/admin/school-year');
    await expect(
      page.getByRole('heading', { name: /school year rollover/i }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
    // The setting shows the current year as text + an Edit button; the input
    // (aria-label "Current school year") only renders once editing.
    await expect(page.getByText('Current school year').filter({ visible: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).filter({ visible: true }).first().click();
    await expect(
      page.getByLabel('Current school year').filter({ visible: true }).first(),
    ).toBeVisible();
  });
});
