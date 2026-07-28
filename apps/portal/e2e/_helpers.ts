import type { Locator, Page } from '@playwright/test';

/**
 * ── THE ONE DEFINITION OF WHERE THE SUITE POINTS ────────────────────────────
 *
 * `playwright.config.ts` imports these, and every spec that builds its OWN
 * request context (for a second persona's cookies) must use `E2E_BASE_URL`
 * rather than re-reading the env var.
 *
 * Why this is centralised: nine call sites across eight specs each had their own
 * `E2E_BASE_URL`. That was
 * invisible while everyone passed the env var explicitly on the command line.
 * The moment the default moved into the config (2026-07-28), all nine silently
 * fell back to localhost and failed with ECONNREFUSED against a dev server that
 * is deliberately not running - a failure that reads like a product fault and is
 * not one. A default only helps if there is exactly one place it lives.
 */
export const PREVIEW_BASE_URL = 'https://cmt-setu-preview.vercel.app';
export const LOCAL_BASE_URL = 'http://localhost:3001';
export const E2E_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? PREVIEW_BASE_URL;

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

// Dedicated fixture for the gated co-manager join-request flow, seeded by
// scripts/seed-join-request-family.ts (UAT). A MANAGER (sign-in) + a GATED
// member (portalAccess:'pending' → request-to-join). Password defaults to
// E2E_FAMILY_PASSWORD when E2E_JR_PASSWORD is unset (the seed does the same).
export const JR_MANAGER_EMAIL =
  process.env.E2E_JR_MANAGER_EMAIL ?? 'e2e-jr-manager@chinmayatoronto.org';
export const JR_MEMBER_EMAIL =
  process.env.E2E_JR_MEMBER_EMAIL ?? 'e2e-jr-member@chinmayatoronto.org';
export const JR_PASSWORD = process.env.E2E_JR_PASSWORD ?? process.env.E2E_FAMILY_PASSWORD;
export const hasJoinRequestCreds = Boolean(JR_PASSWORD);

// Dedicated fixture for the profile-completion gate, seeded by
// scripts/seed-profile-completion-family.ts (UAT). A MANAGER who is deliberately
// gate-INCOMPLETE (a real gender + email + phone, but no foodAllergies and no
// volunteeringSkills) → signing in redirects to /complete-profile.
// Password defaults to E2E_FAMILY_PASSWORD when E2E_PC_PASSWORD is unset (the
// seed does the same).
export const PC_MANAGER_EMAIL =
  process.env.E2E_PC_MANAGER_EMAIL ?? 'e2e-pc-manager@chinmayatoronto.org';
export const PC_PASSWORD = process.env.E2E_PC_PASSWORD ?? process.env.E2E_FAMILY_PASSWORD;
export const hasProfileCompletionCreds = Boolean(PC_PASSWORD);

// Dedicated fixture for the centre-confirmation prompt (spec 1.9c), seeded by
// scripts/seed-centre-confirmation-family.ts (UAT). A manager whose family is
// COMPLETE in every other respect - members and home address both done - with
// only `locationNeedsConfirmation: true` outstanding. That exact shape is what
// produced the permanent /complete-profile <-> /family loop, and a fixture
// incomplete in any other way would not exercise it.
export const CENTRE_MANAGER_EMAIL =
  process.env.E2E_CENTRE_MANAGER_EMAIL ?? 'e2e-centre-manager@chinmayatoronto.org';
export const CENTRE_PASSWORD = process.env.E2E_CENTRE_PASSWORD ?? process.env.E2E_FAMILY_PASSWORD;
export const hasCentreConfirmationCreds = Boolean(CENTRE_PASSWORD);

// Dedicated fixtures for the Adult Study Class gate (spec §2.3's scenario
// matrix), seeded by scripts/seed-adult-class-fixtures.ts (UAT). ONE FAMILY PER
// ROW, not one family reshaped between phases, for two reasons: the sign-in rate
// limit is keyed on the normalized email (mint-password-session.ts:49), so
// separate emails mean separate 5-per-15-minute budgets rather than one shared
// one; and §2.3 is explicit that "a fixture that happens to satisfy both proves
// neither", which reshaping in place cannot honour.
//
//   row1  Bala Vihar, 2 adults, neither teaches  → gate fires, both selectable
//   row2  Bala Vihar, 2 adults, co-adult teaches → gate fires, ONE selectable
//   row3  Bala Vihar, 2 adults, both teach       → silent (empty selectable set)
//   row5  Bala Vihar, 1 adult, does not teach    → gate fires, preselected
//   row6  no Bala Vihar, 2 adults, neither teaches → silent (may enroll at $101)
//   row7  no Bala Vihar, 2 adults, both teach    → silent, failing BOTH conditions
export const ADULT_CLASS_EMAILS = {
  row1: 'e2e-ac-row1@chinmayatoronto.org',
  row2: 'e2e-ac-row2@chinmayatoronto.org',
  row3: 'e2e-ac-row3@chinmayatoronto.org',
  row5: 'e2e-ac-row5@chinmayatoronto.org',
  row6: 'e2e-ac-row6@chinmayatoronto.org',
  row7: 'e2e-ac-row7@chinmayatoronto.org',
} as const;
export const ADULT_CLASS_PASSWORD =
  process.env.E2E_ADULT_CLASS_PASSWORD ?? process.env.E2E_FAMILY_PASSWORD;
export const hasAdultClassCreds = Boolean(ADULT_CLASS_PASSWORD);
