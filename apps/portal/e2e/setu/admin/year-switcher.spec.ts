import { test, expect, type Page } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Phase 2 — admin school-year switcher (Past / Live / Preparing). The single UAT
// test user is family-manager + admin, so the switcher renders in the admin
// chrome. Selectable years come from BV offering termLabels.
//
// NON-DESTRUCTIVE: this spec never Activates / flips the live year. It only
// reads surfaces and asserts the read-only / not-live states, plus the past-year
// write guard and the live-year calendar scoping. The only write it attempts (a
// past-year calendar POST) is expected to be REJECTED (409).
//
// ── TWO THINGS THIS SPEC USED TO GET WRONG, BOTH FIXED 2026-07-27 ───────────
// 1. It drove a `<select id="sy-switch">`. `ae75705` replaced that with a
//    button + role="listbox" popover (SchoolYearScopeBar), so every assertion
//    failed on a missing element rather than on the feature. It now drives the
//    button/option pair, and asserts the bar's `data-status` attribute rather
//    than its prose - copy is rewritten far more often than a state machine is.
// 2. It hardcoded "the live year is 2025-26" and "2026-27 is Preparing". The
//    portal rolled over to 2026-27, so those assertions inverted and the spec
//    reported a product failure where there was none. Nothing here names a year
//    any more: the live year is read from the API and past/preparing are derived
//    by comparison, exactly as `resolveViewYear` does it.
//
// Requires BV offerings spanning more than one school year (any past or
// preparing year will do); tests that need one skip themselves if none exists.
test.describe('Phase 2 — School-year switcher (/admin/levels)', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  /** The scope bar renders in both the desktop and mobile trees; take the visible one. */
  function scopeBar(page: Page) {
    return page.getByTestId('school-year-scope-bar').filter({ visible: true }).first();
  }

  /** Open the year popover and return the years it offers, in display order. */
  async function openPicker(page: Page): Promise<string[]> {
    const trigger = scopeBar(page).getByRole('button', { name: /Change school year/i });
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await trigger.click();
    const options = scopeBar(page).getByRole('option');
    await expect(options.first()).toBeVisible({ timeout: 10_000 });
    return (await options.allInnerTexts()).map((t) => (t.match(/\d{4}-\d{2}/) ?? [''])[0]).filter(Boolean);
  }

  async function liveYearOf(page: Page): Promise<string> {
    const res = await page.request.get('/api/admin/school-year', { timeout: 30_000 });
    expect(res.ok(), `could not read the live school year: ${res.status()}`).toBeTruthy();
    return ((await res.json()) as { config: { currentYear: string } }).config.currentYear;
  }

  test('the switcher offers the live year, and every year it offers has BV data', async ({ page }) => {
    await page.goto('/admin/levels');
    const live = await liveYearOf(page);
    const years = await openPicker(page);

    expect(years.length, 'the switcher offered no years at all').toBeGreaterThanOrEqual(1);
    expect(years, 'the live year must always be selectable').toContain(live);
    for (const y of years) expect(y).toMatch(/^\d{4}-\d{2}$/);
  });

  test('selecting a non-live year scopes the page to it and marks it not-live', async ({ page }) => {
    await page.goto('/admin/levels');
    const live = await liveYearOf(page);
    const years = await openPicker(page);
    const other = years.find((y) => y !== live);
    test.skip(!other, 'only one school year has BV data - nothing to switch to');

    await scopeBar(page).getByRole('option').filter({ hasText: other! }).first().click();
    await page.waitForURL(new RegExp(`year=${other!}`), { timeout: 20_000 });

    // `past` for an earlier year, `preparing` for a later one - the same
    // comparison resolveViewYear makes. Either way it must NOT read as live.
    const expected = other! < live ? 'past' : 'preparing';
    await expect(scopeBar(page)).toHaveAttribute('data-status', expected, { timeout: 20_000 });
  });

  test('a PAST year is read-only — the create control is disabled and a past-year write is rejected', async ({ page }) => {
    await page.goto('/admin/levels');
    const live = await liveYearOf(page);
    const years = await openPicker(page);
    const past = years.filter((y) => y < live).sort().reverse()[0];
    test.skip(!past, 'no past school year has BV data');

    await page.goto(`/admin/levels?year=${past}`);
    await expect(scopeBar(page)).toHaveAttribute('data-status', 'past', { timeout: 20_000 });

    // The primary mutate control on the Levels table is disabled when read-only.
    const newLevelBtn = page.getByRole('button', { name: '+ New level' }).filter({ visible: true }).first();
    await expect(newLevelBtn).toBeVisible({ timeout: 20_000 });
    await expect(newLevelBtn).toBeDisabled();

    // Server-side past-year write guard: a calendar entry dated inside a past
    // school year is rejected by assertWritableYear (409). A school year labelled
    // "2024-25" starts in Sept 2024, so its first September is the leading year.
    const septOfPast = `${past.slice(0, 4)}-09-07`;
    const res = await page.request.post('/api/admin/calendar', {
      data: {
        programKey: 'bala-vihar',
        location: 'Brampton',
        date: septOfPast,
        kind: 'class',
        classType: 'regular',
        enabled: true,
        prasadNeeded: true,
      },
      timeout: 30_000,
    });
    expect(res.status(), 'a past-year calendar write was NOT rejected').toBe(409);
  });

  test('GET /api/setu/calendar is scoped to the live year', async ({ page }) => {
    const live = await liveYearOf(page);
    const res = await page.request.get('/api/setu/calendar?location=Brampton', { timeout: 30_000 });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { entries?: { date: string }[] };
    const dates = (body.entries ?? []).map((e) => e.date);

    // A school year runs Sept→Aug, so every live-year date falls in [YYYY-09-01,
    // (YYYY+1)-08-31]. Anything outside that window leaked in from another year.
    const startYear = Number(live.slice(0, 4));
    for (const d of dates) {
      const t = new Date(`${d}T00:00:00Z`).getTime();
      expect(t, `calendar entry ${d} is outside the live year ${live}`).toBeGreaterThanOrEqual(
        Date.parse(`${startYear}-09-01T00:00:00Z`),
      );
      expect(t, `calendar entry ${d} is outside the live year ${live}`).toBeLessThanOrEqual(
        Date.parse(`${startYear + 1}-08-31T00:00:00Z`),
      );
    }
  });

  test('GET /api/setu/dashboard reports the SAME live year the admin API does', async ({ page }) => {
    // Asserted as agreement between two surfaces rather than against a literal.
    // A hardcoded year turns every legitimate rollover into a red suite.
    const live = await liveYearOf(page);
    const res = await page.request.get('/api/setu/dashboard', { timeout: 30_000 });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { schoolYear?: unknown };
    expect(typeof body.schoolYear).toBe('string');
    expect(body.schoolYear, 'the family dashboard and the admin API disagree about the live year').toBe(live);
  });
});
