import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Phase 3 (Roster): the single E2E user is family-manager + admin, so the
// authenticated storageState (family.json) reaches /welcome/roster (welcome-team
// gate; admin inherits welcome-team). Read-only feature — no mutations, no
// cleanup. The screen renders mobile + desktop blocks both in the DOM, so we
// filter to the visible (desktop, since the `setu` project is Desktop Chrome)
// instances to avoid strict-mode multi-match.
test.describe('Phase 3 — Roster (/welcome/roster)', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('browse → search-as-filter (by FID) → drill into family detail', async ({ page }) => {
    await page.goto('/welcome/roster');

    // Browse list renders at least one family card (UAT has migrated families).
    const results = page.getByTestId('roster-results').filter({ visible: true });
    await expect(results.getByRole('link').first()).toBeVisible({ timeout: 20_000 });

    // Search-as-filter: the seeded family's FID is a deterministic single hit.
    await page.getByTestId('roster-search-input').filter({ visible: true }).fill('CMT-FSWEDU2X');

    // Its card (name "E2E Test Family") appears, scoped to the visible results.
    const hit = results.getByText(/E2E Test Family/i).first();
    await expect(hit).toBeVisible({ timeout: 20_000 });

    // Drill into the family → existing read-only family detail page.
    await hit.click();
    await expect(page).toHaveURL(/\/welcome\/family\/CMT-FSWEDU2X/, { timeout: 20_000 });
  });

  test('CSV export endpoint returns text/csv for the signed-in welcome/admin user', async ({ page }) => {
    const res = await page.request.get('/api/welcome/families?format=csv&limit=5');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    const body = await res.text();
    expect(body).toContain('familyName,fid,legacyFid,memberName,type,grade,location,programs,payment');
  });

  test('migration-status endpoint returns legacy-vs-portal counts', async ({ page }) => {
    // Reads the legacy 715b8 RTDB roster (~hundreds of families) read-only, so
    // allow a generous timeout.
    const res = await page.request.get('/api/welcome/families/migration-status', { timeout: 45_000 });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { legacyTotal: number; migrated: number; missing: number };
    expect(typeof body.legacyTotal).toBe('number');
    expect(typeof body.migrated).toBe('number');
    expect(typeof body.missing).toBe('number');
    // The seeded family (CMT-FSWEDU2X) was migrated, so at least some are migrated.
    expect(body.legacyTotal).toBeGreaterThan(0);
  });
});
