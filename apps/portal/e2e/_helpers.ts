import type { Locator, Page } from '@playwright/test';

/** The family pages render mobile + desktop blocks both in the DOM; pick the
 *  visible one to avoid strict-mode multi-match. */
export function visibleText(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).filter({ visible: true });
}

export const E2E_FAMILY_EMAIL = process.env.E2E_FAMILY_EMAIL;
export const E2E_FAMILY_PASSWORD = process.env.E2E_FAMILY_PASSWORD;
export const hasFamilyCreds = Boolean(E2E_FAMILY_EMAIL && E2E_FAMILY_PASSWORD);

// Role-persona test accounts seeded by scripts/seed-test-accounts.ts (UAT).
// One shared password via TEST_ACCOUNTS_PASSWORD; emails are fixed.
export const TEST_ACCOUNTS_PASSWORD = process.env.TEST_ACCOUNTS_PASSWORD;
export const hasTestAccounts = Boolean(TEST_ACCOUNTS_PASSWORD);
export const TEST_ACCOUNT_EMAILS = {
  parentBrampton: 'setu-test-parent-brampton@chinmayatoronto.org',
  memberBrampton: 'setu-test-member-brampton@chinmayatoronto.org',
  parentScarborough: 'setu-test-parent-scarborough@chinmayatoronto.org',
  teacherBrampton: 'setu-test-teacher-brampton@chinmayatoronto.org',
  teacherScarborough: 'setu-test-teacher-scarborough@chinmayatoronto.org',
  teacherUniversal: 'setu-test-teacher-universal@chinmayatoronto.org',
  sevak: 'setu-test-sevak@chinmayatoronto.org',
  admin: 'setu-test-admin@chinmayatoronto.org',
} as const;
