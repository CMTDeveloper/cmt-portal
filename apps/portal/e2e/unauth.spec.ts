import { test, expect } from '@playwright/test';

// This project runs WITHOUT storageState (see playwright.config 'unauthenticated').
test('unauthenticated /family redirects to /sign-in', async ({ page }) => {
  await page.goto('/family');
  await expect(page).toHaveURL(/\/sign-in/);
});
