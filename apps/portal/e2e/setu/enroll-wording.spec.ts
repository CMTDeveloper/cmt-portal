import { test, expect } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';

test.describe('enroll page wording', () => {
  test.skip(!hasFamilyCreds, 'E2E family creds required');

  test('Bala Vihar donation flow shows the donation block', async ({ page }) => {
    // a75613d moved the BV donation off the enroll page into the dedicated
    // donate flow, and the enroll page only opens while a program has an OPEN
    // offering window (BV 2025-26's has since closed → "no open enrollment").
    // Verify the donation wording where it now lives: the donate page for the
    // seeded family's active BV enrollment (eid = fid-oid; stable per the seed).
    await page.goto('/family/donate?eid=CMT-FSWEDU2X-bv-brampton-2025-26');
    await expect(visibleText(page, /Your donation/i).first()).toBeVisible();
    await expect(visibleText(page, /not a fee/i).first()).toBeVisible();
  });

  test('no-donation program shows "no donation requirement" and never "donation coming soon"', async ({ page }) => {
    await page.goto('/family/enroll/om-chanting');
    await expect(visibleText(page, /no donation requirement/i)).toBeVisible();
    await expect(page.getByText(/Proceed to donate below/i)).toHaveCount(0);
    await expect(page.getByText(/donation coming soon/i)).toHaveCount(0);
    await expect(visibleText(page, /Your family is (already )?enrolled/i).first()).toBeVisible();
  });
});
