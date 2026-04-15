import { test, expect } from './fixtures';

const PASSPHRASE = process.env.E2E_TEACHER_PASSPHRASE ?? process.env.TEACHER_PASSPHRASE ?? '';

test.describe('B3 — teacher portal', () => {
  test('teacher login → dashboard flow', async ({ page }) => {
    test.skip(!PASSPHRASE, 'TEACHER_PASSPHRASE not available');
    await page.goto('/login/teacher');
    await page.getByLabel(/passphrase/i).fill(PASSPHRASE);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL('/check-in/teacher');
    await expect(page.getByRole('heading', { name: /teacher/i })).toBeVisible();
  });

  test('unauthenticated /check-in/teacher redirects', async ({ page }) => {
    await page.goto('/check-in/teacher');
    await expect(page).toHaveURL(/\/login/);
  });
});
