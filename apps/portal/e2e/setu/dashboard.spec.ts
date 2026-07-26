import { test, expect } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';

test.describe('family dashboard', () => {
  test.skip(!hasFamilyCreds, 'E2E family creds required');

  test('shows Bala Vihar enrolled + real attendance (not the hijack empty state)', async ({ page }) => {
    await page.goto('/family');

    await expect(visibleText(page, /Hari OM/i)).toBeVisible();
    await expect(visibleText(page, /Bala Vihar/i).first()).toBeVisible();

    // The regression this test exists for (2026-06-01): a newer non-BV
    // enrollment hijacked the dashboard's `find(status === 'active')` pick, so
    // the BV card rendered its NOT-enrolled body and a real family's attendance
    // silently vanished. The guard is that the BV card renders its ENROLLED
    // body, with the per-child list present.
    //
    // Assert the stat PAIR, not a bare /Enrolled/ substring: "Not enrolled" is
    // the failure state and it contains "enrolled", so a loose match passes in
    // exactly the case this test is meant to catch.
    await expect(visibleText(page, /^Enrollment status$/).first()).toBeVisible();
    await expect(visibleText(page, /^Enrolled$/).first()).toBeVisible();
    await expect(page.getByText(/^Not enrolled$/)).toHaveCount(0);

    // The enroll CTA renders ONLY when `!isEnrolled` (page.tsx:334-344), so its
    // absence is the precise inverse of the hijacked not-enrolled body. This is
    // the load-bearing assertion: unlike a copy string it cannot drift, and
    // unlike /Children/ it cannot false-pass off the Family card, which renders
    // its own "Children" member-count row at page.tsx:225.
    await expect(page.getByRole('link', { name: /^Enroll now$/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /add a child to enroll/i })).toHaveCount(0);
  });

  // The "renders a card for the non-BV enrolled program" test was REMOVED here.
  // a04ab2b cut the other-program cards from /family (466 lines to 124) and the
  // "Enrolled · View enrollment" affordance moved to /family/programs, where
  // programs.spec.ts already asserts it. The test had been failing against
  // deployed UAT ever since, asserting copy that no longer exists on this route.
});
