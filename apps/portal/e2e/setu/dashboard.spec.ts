import { test, expect } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';

test.describe('family dashboard', () => {
  test.skip(!hasFamilyCreds, 'E2E family creds required');

  test('shows Bala Vihar enrolled + real attendance (not the hijack empty state)', async ({ page }) => {
    await page.goto('/family');

    await expect(visibleText(page, /Hari OM/i)).toBeVisible();
    await expect(visibleText(page, /Bala Vihar/i).first()).toBeVisible();
    await expect(visibleText(page, /Enrolled/i).first()).toBeVisible();

    // Attendance rendered from the seeded check-ins — the regression guard.
    // Accept either block's phrasing ("class Sundays" desktop / "Sunday classes"
    // mobile) so a copy tweak to one doesn't break the guard; visibleText still
    // pins it to the visible (desktop) instance.
    await expect(visibleText(page, /Attended \d+ of \d+ (class Sundays|Sunday classes)/i)).toBeVisible();
    await expect(page.getByText(/Attendance will appear here once Sunday classes begin/i)).toHaveCount(0);
  });

  test('renders a card for the non-BV enrolled program', async ({ page }) => {
    await page.goto('/family');
    await expect(visibleText(page, /View enrollment/i).first()).toBeVisible();
  });
});
