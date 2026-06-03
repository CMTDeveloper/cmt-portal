import type { Locator, Page } from '@playwright/test';

/** The family pages render mobile + desktop blocks both in the DOM; pick the
 *  visible one to avoid strict-mode multi-match. */
export function visibleText(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).filter({ visible: true });
}

export const E2E_FAMILY_EMAIL = process.env.E2E_FAMILY_EMAIL;
export const E2E_FAMILY_PASSWORD = process.env.E2E_FAMILY_PASSWORD;
export const hasFamilyCreds = Boolean(E2E_FAMILY_EMAIL && E2E_FAMILY_PASSWORD);
