import { test, expect } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';

test.describe('enroll page wording', () => {
  test.skip(!hasFamilyCreds, 'E2E family creds required');

  test('Bala Vihar (donation) shows the dakshina block', async ({ page }) => {
    await page.goto('/family/enroll/bala-vihar');
    await expect(visibleText(page, /Dakshina/i).first()).toBeVisible();
    await expect(visibleText(page, /suggested donation/i).first()).toBeVisible();
  });

  test('no-donation program shows "no donation requirement" and never "donation coming soon"', async ({ page }) => {
    await page.goto('/family/enroll/om-chanting');
    await expect(visibleText(page, /no donation requirement/i)).toBeVisible();
    await expect(page.getByText(/Proceed to donate below/i)).toHaveCount(0);
    await expect(page.getByText(/donation coming soon/i)).toHaveCount(0);
    await expect(visibleText(page, /Your family is (already )?enrolled/i).first()).toBeVisible();
  });
});
