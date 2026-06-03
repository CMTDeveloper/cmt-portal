import { test, expect } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';

test.describe('programs list', () => {
  test.skip(!hasFamilyCreds, 'E2E family creds required');

  test('enrolled programs show "Enrolled · View enrollment", not "Enroll"', async ({ page }) => {
    await page.goto('/family/programs');
    await expect(visibleText(page, /Enrolled · View enrollment/i).first()).toBeVisible();
  });
});
