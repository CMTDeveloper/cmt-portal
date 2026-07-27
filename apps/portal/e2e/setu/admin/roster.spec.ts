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

    // Real UAT data has Bala Vihar levels (this IS the per-level report), so the Level
    // dropdown MUST offer a "Level ..." option - a hard assertion (not a soft guard,
    // which would let an empty Level list pass vacuously). Select it and confirm the
    // filtered list + by-level summary. (Filters are dropdowns, not chips.)
    const levelSelect = page.getByRole('combobox', { name: 'Level' }).filter({ visible: true }).first();
    await expect(levelSelect).toBeVisible({ timeout: 15_000 });
    await expect(levelSelect.locator('option', { hasText: /^Level /i }).first()).toBeAttached({ timeout: 15_000 });
    // Widen the Enrollment filter to "All" BEFORE narrowing by level. The
    // roster now defaults that filter to `enrolled` (DEFAULT_ENGAGEMENT), so
    // level+enrolled is an intersection that can legitimately be empty - and an
    // empty intersection is not a broken level filter. Combining the page's own
    // default with a second filter is what made this assertion fail.
    const enrollSelect = page.getByRole('combobox', { name: 'Enrollment' }).filter({ visible: true }).first();
    await expect(enrollSelect).toBeVisible({ timeout: 15_000 });
    await enrollSelect.selectOption('');

    // Pick a level that actually HAS families, read from the summary's own
    // "By level" chips (which are computed over the CURRENTLY filtered rows).
    // Selecting `index: 1` was the bug in this assertion: the dropdown is built
    // by deriveLevelOptions from ALL rows, so the first option can legitimately
    // match nobody under the active filters - an empty result then read as a
    // broken level filter.
    // Slice the SECTION between the "By level:" and "Enrollment:" headings.
    // Not a single line: each chip is its own flex child, so innerText puts
    // every one on a separate line and the "By level:" line carries no counts
    // at all. The Enrollment / Payment rows use the same "name · count" shape,
    // which is why the slice has to be bounded on both ends.
    const summaryText = await summary.innerText();
    const from = summaryText.indexOf('By level:');
    expect(from, 'the summary showed no "By level" breakdown to choose from').toBeGreaterThanOrEqual(0);
    const to = summaryText.indexOf('Enrollment:', from);
    const byLevelSection = summaryText.slice(from + 'By level:'.length, to === -1 ? undefined : to);

    const populated = [...byLevelSection.matchAll(/(.+?)\s+·\s+(\d+)/g)]
      .map((m) => ({ name: m[1]!.trim(), count: Number(m[2]) }))
      .find((x) => x.count > 0);
    expect(populated, `no level has any children in it. Section was: ${byLevelSection}`).toBeTruthy();

    await levelSelect.selectOption({ label: populated!.name });
    await expect(results.getByRole('link').first()).toBeVisible({ timeout: 15_000 });
    await expect(summary.getByText(/By level/i)).toBeVisible({ timeout: 10_000 });
  });

  test('Engagement filter narrows the list, summary shows the split, and no card leaks CMT-', async ({ page }) => {
    await page.goto('/welcome/roster');
    const results = page.getByTestId('roster-results').filter({ visible: true });
    await expect(results.getByRole('link').first()).toBeVisible({ timeout: 30_000 });

    // No visible card text shows the internal CMT- doc id as a Family ID - a
    // never-enrolled family shows its Legacy id, not a minted FID (and never CMT-).
    await expect(results).not.toContainText('FID CMT-');

    // The summary carries the issue-#23 engagement split (Enrolled / Registered
    // / Not enrolled). The LABEL on that row was renamed "Engagement:" ->
    // "Enrollment:"; the counts it introduces are what matter, so assert those
    // rather than the heading word, which is free to change again.
    const summary = page.getByTestId('roster-summary').filter({ visible: true });
    await expect(summary.getByText(/Enrolled ·/)).toBeVisible({ timeout: 30_000 });
    await expect(summary.getByText(/Registered ·/)).toBeVisible({ timeout: 10_000 });
    await expect(summary.getByText(/Not enrolled ·/)).toBeVisible({ timeout: 10_000 });

    // Filtering to "Registered" shows only carry-forwards (every card has a
    // Registered badge). The control is labelled "Enrollment" - it was
    // "Engagement" when this spec was written.
    const engSelect = page.getByRole('combobox', { name: 'Enrollment' }).filter({ visible: true }).first();
    await expect(engSelect).toBeVisible({ timeout: 15_000 });

    // How many families the summary SAYS are Registered, before filtering to
    // them. "Registered" means a carry-forward enrollment, and since the
    // 2026-07-20 rollover change stopped creating those, an empty Registered
    // bucket is a legitimate state - not a broken filter. Asserting a non-empty
    // list here was a data assumption that the rollover redesign invalidated.
    const registeredCount = Number(
      ((await summary.innerText()).match(/Registered\s+·\s+(\d+)/) ?? [, '0'])[1],
    );

    await engSelect.selectOption('registered');
    if (registeredCount > 0) {
      await expect(results.getByRole('link').first()).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(results.getByRole('link')).toHaveCount(0, { timeout: 15_000 });
    }
    // Either way the filter must EXCLUDE enrolled families: no Enrolled-badged
    // card may remain. This is the assertion the test is actually for, and it
    // holds whether the Registered bucket is populated or empty.
    await expect(results.getByText('Enrolled', { exact: true })).toHaveCount(0);
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
