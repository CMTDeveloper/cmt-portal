import { test, expect } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';

test.describe('family dashboard', () => {
  test.skip(!hasFamilyCreds, 'E2E family creds required');

  test('shows Bala Vihar enrolled + real attendance (not the hijack empty state)', async ({ page }) => {
    await page.goto('/family');

    await expect(visibleText(page, /Hari OM/i)).toBeVisible();
    await expect(visibleText(page, /Bala Vihar/i).first()).toBeVisible();
    await expect(visibleText(page, /Enrolled/i).first()).toBeVisible();

    // a75613d moved attendance off the family dashboard to per-child profiles:
    // the BV card now shows a "tracked per child" pointer instead of a
    // family-level "Attended X of Y" count. The regression guard (originally
    // "not the hijack empty state") is that the BV card renders its ENROLLED
    // body — this pointer — never the not-enrolled empty state the hijack bug
    // produced.
    await expect(visibleText(page, /attendance is tracked per child/i).first()).toBeVisible();
    await expect(page.getByText(/Attendance will appear here once Sunday classes begin/i)).toHaveCount(0);
  });

  test('renders a card for the non-BV enrolled program', async ({ page }) => {
    await page.goto('/family');
    await expect(visibleText(page, /View enrollment/i).first()).toBeVisible();
  });
});
