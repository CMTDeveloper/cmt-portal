import { test, expect } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';

test.describe('family dashboard', () => {
  test.skip(!hasFamilyCreds, 'E2E family creds required');

  // ── 🔴 The page must be in <main>, not swallowed into the sidebar ──────────
  //
  // Reported for weeks as "blank page / broken CSS after a mutation, fixed by a
  // hard refresh" and never reproduced until 2026-07-28, when it was caught live
  // in the owner's browser: the dashboard was rendering INSIDE the 248px
  // <aside>, its heading squeezed to x=18 w=211 instead of x=296 w=1384. The
  // stylesheet was fine throughout (588 rules, `md:` utilities resolving) - the
  // content was simply in the wrong box.
  //
  // Cause: `family/layout.tsx` had the sidebar's Suspense boundary as a bare
  // sibling of <main> inside one flex parent. React streams a boundary in by
  // locating comment markers among its PARENT'S children, so a marker mismatch
  // let that boundary swallow what followed it. It is now wrapped in its own
  // container; `admin`, `teacher` and `welcome` never had the shape.
  //
  // Asserted here rather than in a component test because the misplacement
  // happens during real streaming - jsdom resolves Suspense instantly and can
  // never see it. `aside.textContent.length` is the discriminator: ~90-115 when
  // healthy, thousands when the page has been swallowed.
  test('the page renders in <main>, never inside the sidebar', async ({ page }) => {
    await page.goto('/family');
    await expect(visibleText(page, /Hari OM/i)).toBeVisible({ timeout: 25_000 });

    const aside = page.locator('aside').filter({ visible: true }).first();
    await expect(aside).toBeVisible();

    // The greeting belongs to the page, so it must NOT be inside the sidebar.
    await expect(
      aside.getByRole('heading', { name: /Hari OM/i }),
      'the dashboard has been swallowed into the sidebar - see the comment above',
    ).toHaveCount(0);

    // And the visible heading must have page width, not sidebar width. 248px is
    // the sidebar; anything at or under it means the content is in the wrong box
    // even if the DOM check above somehow passed.
    const box = await page.getByRole('heading', { name: /Hari OM/i }).filter({ visible: true }).first().boundingBox();
    expect(box, 'no visible greeting to measure').not.toBeNull();
    expect(box!.width, `greeting is ${Math.round(box!.width)}px wide - sidebar width is 248`).toBeGreaterThan(400);
  });

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
