import { test, expect } from '../fixtures';

const PASSPHRASE = process.env.E2E_TEACHER_PASSPHRASE ?? process.env.TEACHER_PASSPHRASE ?? '';

test.describe('B3 — teacher portal', () => {
  test('teacher login → dashboard flow', async ({ page }) => {
    // The legacy check-in teacher passphrase login is deprecated (the Setu
    // /teacher portal replaces it). Skip by default — opt in with E2E_LEGACY=1
    // when intentionally regression-testing the legacy kiosk. (Previously this
    // guarded only on TEACHER_PASSPHRASE, which is set in .env.local for other
    // tooling, so the stale flow ran and failed.)
    test.skip(process.env.E2E_LEGACY !== '1' || !PASSPHRASE, 'legacy check-in teacher login deprecated; set E2E_LEGACY=1 to run');
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
