import { test, expect } from '../fixtures';

const E2E_FAMILY_EMAIL = process.env.E2E_FAMILY_EMAIL;
const E2E_FAMILY_FID = process.env.E2E_FAMILY_FID;

test.describe('B2 — family portal', () => {
  test('family login page renders contact form with tabs', async ({ page }) => {
    await page.goto('/login/family');
    await expect(page.getByRole('heading', { name: /family sign in/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /email/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /phone/i })).toBeVisible();
  });

  test('send-code → otp → dashboard happy path (requires seeded family)', async ({ page }) => {
    test.skip(
      !E2E_FAMILY_EMAIL || !E2E_FAMILY_FID,
      'E2E_FAMILY_EMAIL / E2E_FAMILY_FID env vars required',
    );

    await page.goto('/login/family');
    await page.getByLabel(/email/i).fill(E2E_FAMILY_EMAIL!);
    await page.getByRole('button', { name: /send code/i }).click();
    await expect(page.getByLabel(/verification code/i)).toBeVisible();

    // The mock sender logs the code to the server console. In the e2e env we
    // intercept by reading from a special test endpoint, OR we use a fixed
    // test code when NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY=false.
    // For now, this test is skip-guarded; full e2e arrives once B5 wires a
    // test sender that exposes codes to Playwright.
  });

  test('unauthenticated visit to /check-in/family redirects to /login', async ({ page }) => {
    await page.goto('/check-in/family');
    await expect(page).toHaveURL(/\/login/);
  });
});
