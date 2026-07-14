import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Roster report: the single E2E user is family-manager + admin, so the
// authenticated storageState reaches /welcome/roster (welcome-team gate; admin
// inherits). Read-only - no mutations, no cleanup. Mobile + desktop blocks both
// render in the DOM; scope to the visible (desktop) instances.
test.describe('Roster report (/welcome/roster)', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('bulk-loads families, shows the live summary, and filters', async ({ page }) => {
    await page.goto('/welcome/roster');

    const results = page.getByTestId('roster-results').filter({ visible: true });
    await expect(results.getByRole('link').first()).toBeVisible({ timeout: 30_000 });

    // Live summary strip renders with a family count.
    const summary = page.getByTestId('roster-summary').filter({ visible: true });
    await expect(summary.getByText(/famil(y|ies)/i)).toBeVisible({ timeout: 30_000 });

    // Real UAT data has Bala Vihar levels (this IS the per-level report), so a Level
    // chip MUST render - a hard assertion (not a soft guard, which would let an empty
    // Level list pass vacuously). Filter by it and confirm the list + by-level summary.
    const levelChip = page.getByRole('button', { name: /^Level /i }).first();
    await expect(levelChip).toBeVisible({ timeout: 15_000 });
    await levelChip.click();
    await expect(results.getByRole('link').first()).toBeVisible({ timeout: 15_000 });
    await expect(summary.getByText(/By level/i)).toBeVisible({ timeout: 10_000 });
  });

  test('search-as-filter (by FID) -> drill into family detail', async ({ page }) => {
    await page.goto('/welcome/roster');
    const results = page.getByTestId('roster-results').filter({ visible: true });
    await page.getByTestId('roster-search-input').filter({ visible: true }).fill('CMT-FSWEDU2X');
    // The card title is now the PARENT name (not "... family Family"), so locate the
    // seeded family's result by its link href, not by a family-name string.
    const hit = results.locator('a[href*="/welcome/family/CMT-FSWEDU2X"]').first();
    await expect(hit).toBeVisible({ timeout: 20_000 });
    // The old "<name> Family" suffix must be gone from the result card.
    await expect(hit).not.toContainText(/family Family/i);
    await hit.click();
    await expect(page).toHaveURL(/\/welcome\/family\/CMT-FSWEDU2X/, { timeout: 20_000 });
  });

  test('CSV export returns text/csv with the new level column header', async ({ page }) => {
    const res = await page.request.get('/api/welcome/roster/report?format=csv', { timeout: 45_000 });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    const body = await res.text();
    expect(body).toContain('familyName,fid,legacyFid,memberName,type,grade,level,location,programs,payment');
  });

  test('migration-status endpoint still returns legacy-vs-portal counts', async ({ page }) => {
    const res = await page.request.get('/api/welcome/families/migration-status', { timeout: 45_000 });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { legacyTotal: number; migrated: number; missing: number };
    expect(body.legacyTotal).toBeGreaterThan(0);
  });
});
