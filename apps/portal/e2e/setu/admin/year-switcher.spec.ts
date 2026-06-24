import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Phase 2 — admin school-year switcher (Past / Live / Preparing). The single UAT
// test user is family-manager + admin, so the switcher renders in the admin
// chrome. Selectable years come from BV offering termLabels (the year-switcher
// fixture seeds a Past `2024-25` + Preparing `2026-27` alongside the live
// `2025-26`). Screens dual-render mobile + desktop blocks both in the DOM →
// filter to the visible instance and use generous timeouts.
//
// NON-DESTRUCTIVE: this spec never Activates / flips the live year. It only
// reads surfaces and asserts the read-only / not-live strips, plus the
// past-year write guard and the live-year calendar scoping. The only write it
// attempts (a past-year calendar POST) is expected to be REJECTED (409).
//
// Requires the year-switcher fixture seeded in UAT first:
//   pnpm --filter @cmt/portal seed:year-switcher-fixture
test.describe('Phase 2 — School-year switcher (/admin/levels)', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('switcher lists ≥3 years including 2024-25, 2025-26, 2026-27', async ({ page }) => {
    await page.goto('/admin/levels');
    // Unique id on the switcher <select>; two render (desktop sidebar + mobile
    // nav) → pick the visible one.
    const select = page.locator('#sy-switch').filter({ visible: true }).first();
    await expect(select).toBeVisible({ timeout: 20_000 });

    const optionValues = await select.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value),
    );
    expect(optionValues.length).toBeGreaterThanOrEqual(3);
    expect(optionValues).toContain('2024-25');
    expect(optionValues).toContain('2025-26');
    expect(optionValues).toContain('2026-27');
  });

  test('selecting the Preparing year adds ?year=2026-27 and shows the not-live strip', async ({ page }) => {
    await page.goto('/admin/levels');
    const select = page.locator('#sy-switch').filter({ visible: true }).first();
    await expect(select).toBeVisible({ timeout: 20_000 });

    await select.selectOption('2026-27');
    await page.waitForURL(/year=2026-27/, { timeout: 20_000 });

    await expect(
      page.getByText(/Preparing 2026-27 — not live yet/).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('the Past year is read-only — the create control is disabled and a past-year write is rejected', async ({ page }) => {
    await page.goto('/admin/levels?year=2024-25');

    // The switcher renders the "Past year — read-only" strip.
    await expect(
      page.getByText(/Past year — read-only/).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 20_000 });

    // The primary mutate control on the Levels table is disabled when read-only.
    const newLevelBtn = page
      .getByRole('button', { name: '+ New level' })
      .filter({ visible: true })
      .first();
    await expect(newLevelBtn).toBeVisible({ timeout: 20_000 });
    await expect(newLevelBtn).toBeDisabled();

    // Server-side past-year write guard: a calendar entry dated in a past school
    // year is rejected by assertWritableYear (409 past-year).
    const res = await page.request.post('/api/admin/calendar', {
      data: {
        programKey: 'bala-vihar',
        location: 'Brampton',
        date: '2024-09-07',
        kind: 'class',
        classType: 'regular',
        enabled: true,
        prasadNeeded: true,
      },
      timeout: 30_000,
    });
    expect(res.status()).toBe(409);
  });

  test('GET /api/setu/calendar excludes preparing-year dates', async ({ page }) => {
    const res = await page.request.get('/api/setu/calendar?location=Brampton', { timeout: 30_000 });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const dates: string[] = (body.entries ?? []).map((e: { date: string }) => e.date);
    // The seeded Preparing-year Sunday (2026-09-06) is outside the live 2025-26
    // window, so the live-year-scoped calendar must NOT include it.
    expect(dates).not.toContain('2026-09-06');
  });

  test('GET /api/setu/dashboard exposes the live schoolYear', async ({ page }) => {
    const res = await page.request.get('/api/setu/dashboard', { timeout: 30_000 });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.schoolYear).toBe('string');
    expect(body.schoolYear).toBe('2025-26');
  });
});
