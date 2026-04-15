import { test, expect } from './fixtures';

test.describe('B1 — kiosk', () => {
  test('/check-in is 404 when feature flag is off', async ({ page }) => {
    test.skip(
      process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK === 'true',
      'Kiosk flag is on; flag-off test skipped',
    );
    const res = await page.goto('/check-in');
    expect(res?.status()).toBe(404);
  });

  test('/check-in renders kiosk home when flag is on', async ({ page }) => {
    test.skip(
      process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK !== 'true',
      'Kiosk flag off; flag-on test skipped',
    );
    await page.goto('/check-in');
    await expect(page.getByLabel(/family id/i)).toBeVisible();
  });

  test('/check-in/guest renders guest form when flag is on', async ({ page }) => {
    test.skip(
      process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK !== 'true',
      'Kiosk flag off; skipped',
    );
    await page.goto('/check-in/guest');
    await expect(page.getByLabel(/first name/i)).toBeVisible();
  });

  test('/check-in/lookup renders lookup form when flag is on', async ({ page }) => {
    test.skip(
      process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK !== 'true',
      'Kiosk flag off; skipped',
    );
    await page.goto('/check-in/lookup');
    await expect(page.getByRole('tab', { name: /email/i })).toBeVisible();
  });
});
