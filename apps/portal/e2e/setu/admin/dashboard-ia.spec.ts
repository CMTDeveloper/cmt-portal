import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Phase 1 (admin IA): the single E2E user is family-manager + admin, so the
// authenticated storageState (family.json) can reach /admin/*. These are
// render/IA assertions against the grouped admin dashboard + renamed surfaces.
test.describe('admin dashboard IA', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('dashboard shows the four labelled sections', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: /people & access/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /bala vihar/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^reports$/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /legacy/i })).toBeVisible();
  });

  test('"Users & roles" tile links to /admin/users', async ({ page }) => {
    await page.goto('/admin');
    const tile = page.getByRole('link', { name: /users & roles/i }).first();
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAttribute('href', '/admin/users');
  });

  test('the levels surface is titled "Level management"', async ({ page }) => {
    await page.goto('/admin/levels');
    await expect(page.getByRole('heading', { name: /level management/i })).toBeVisible();
    // The old misleading name is gone.
    await expect(page.getByRole('heading', { name: /levels & teachers/i })).toHaveCount(0);
  });
});
