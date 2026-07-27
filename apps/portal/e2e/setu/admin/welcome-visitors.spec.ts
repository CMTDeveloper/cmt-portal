import { test, expect, type Page } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

/**
 * P2 Task 9 step 2 / spec §5.2 - `/welcome/visitors` against DEPLOYED UAT.
 *
 * The page shipped with no end-to-end test at all, which is the CLAUDE.md rule-7
 * hole that let `/family/seva` 500 in production. Mocked unit tests cover
 * `getAllVisitorsView`; they cannot cover `use cache` / `connection()`, the
 * welcome layout's role gate, or Firestore actually serving the queries.
 *
 * ── Why three guests, not one ──────────────────────────────────────────────────
 * The fixture is built so each assertion would FAIL under the specific bug it
 * guards, rather than merely coexisting with it:
 *
 *   grade 1  → Brampton Level 1 (band ['1']) AND Scarborough Level A (['1','2'])
 *   grade 6  → Brampton Level 4 (['6','7']) AND Scarborough Level C (['5','6'])
 *   Shishu   → matches no class at all
 *
 *   - Two DIFFERENT grades in two DIFFERENT levels is the N=2 grouping case. A
 *     single-guest fixture cannot tell "grouped by class" from "listed".
 *   - Because the door records no centre, each matched child lands in TWO groups.
 *     So the group rows this run adds is 4 while the children is 3: the count line
 *     must move by 3. `getAllVisitorsView` deliberately returns
 *     `children.length`, not the sum of group sizes - with that reversed the delta
 *     would be 4, so this assertion is what holds that decision in place.
 *   - The Shishu guest is the "nobody vanishes" guarantee. A child whose grade
 *     matches nothing must surface in the unmatched bucket, not be silently
 *     dropped - the desk is the only place anyone would notice.
 *
 * Read-only against every real family: the spec creates guest check-ins and
 * deletes exactly those, and never confirms one (which would create a pending
 * family + enrollment).
 *
 * Run (deployed UAT only):
 *   PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app \
 *     pnpm --filter @cmt/portal exec playwright test --project=setu welcome-visitors
 */

const RUN = Date.now().toString(36);

const ALPHA = { key: 'alpha', grade: '1', child: `Alphaguest ${RUN}` };
const BRAVO = { key: 'bravo', grade: '6', child: `Bravoguest ${RUN}` };
const CHARLIE = { key: 'charlie', grade: 'Shishu', child: `Charlieguest ${RUN}` };
const GUESTS = [ALPHA, BRAVO, CHARLIE] as const;

/**
 * `welcome/layout.tsx` renders `{children}` TWICE - once under `.block md:hidden`
 * and once under `.hidden md:flex` - so every element on this page exists twice in
 * the DOM. At Playwright's default 1280px viewport the desktop copy is the visible
 * one; `visible: true` is what keeps every locator below out of strict-mode
 * violations. (Same reason `_helpers.visibleText` exists for the family pages.)
 */

/** The `<section>` whose h2 matches, in the visible copy of the page. */
function group(page: Page, heading: RegExp) {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: heading }) })
    .filter({ visible: true });
}

const BRAMPTON_1 = /^Brampton · Level 1 · /;
const BRAMPTON_4 = /^Brampton · Level 4 · /;
const SCARBOROUGH_A = /^Scarborough · Level A · /;
const SCARBOROUGH_C = /^Scarborough · Level C · /;
const UNMATCHED = /^Not matched to a class \(\d+\)$/;

/** The page's own headline count: "N children checked in." / the empty copy.
 *  Anchored on the count phrasing so it never picks up the "Guests checked in at
 *  the door…" description directly above it. */
async function childCount(page: Page): Promise<number> {
  const line = page
    .locator('p')
    .filter({ hasText: /(\d+ (?:child|children)|No guests) checked in/ })
    .filter({ visible: true })
    .first();
  await expect(line, 'no count line on /welcome/visitors').toBeVisible({ timeout: 20_000 });
  const text = await line.innerText();
  if (/No guests checked in on this date\./.test(text)) return 0;
  const m = text.match(/(\d+)\s+(?:child|children) checked in\./);
  expect(m, `unparseable count line: ${text}`).not.toBeNull();
  return Number(m![1]);
}

async function openVisitors(page: Page): Promise<void> {
  await page.goto('/welcome/visitors');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Visitors' }).filter({ visible: true }),
    '/welcome/visitors did not render for a welcome-team/admin session',
  ).toBeVisible({ timeout: 30_000 });
}

test.describe('/welcome/visitors - the day’s door guests, grouped by class (deployed UAT)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  const writtenIds: string[] = [];
  let baseline = 0;
  /** The Sunday the writer stamped, read back from a doc rather than re-derived. */
  let sunday = '';

  test.afterAll(async () => {
    if (writtenIds.length === 0) return;
    try {
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();
      for (const id of writtenIds) await db.collection('guest_check_ins').doc(id).delete();
    } catch (err) {
      console.warn('welcome-visitors cleanup failed - remove these ids by hand:', writtenIds, err);
    }
  });

  test('seed three door guests through the real check-in route', async ({ page, request }) => {
    // Baseline BEFORE seeding: the page is shared with whatever else checked in
    // today, so every count assertion below is a delta, never an absolute.
    await openVisitors(page);
    baseline = await childCount(page);

    for (const g of GUESTS) {
      const res = await request.post('/api/check-in/guests', {
        data: {
          firstName: g.key,
          lastName: `Parent ${RUN}`,
          email: `e2e-visitors-${g.key}-${RUN}@chinmayatoronto.org`,
          phone: '4165550102',
          numberOfAdults: 1,
          children: [{ name: g.child, grade: g.grade }],
        },
      });
      expect(
        res.status(),
        `guest check-in POST failed - a 404 means NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK is not 'true' on the target deploy: ${await res.text()}`,
      ).toBe(200);
      writtenIds.push(((await res.json()) as { id: string }).id);
    }

    const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
    const snap = await portalFirestore().collection('guest_check_ins').doc(writtenIds[0]!).get();
    sunday = (snap.data() as { sessionDate?: string }).sessionDate ?? '';
    expect(sunday, 'the guest doc carries no sessionDate').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('each guest is grouped under every class their grade matches, at both centres', async ({ page }) => {
    await openVisitors(page);
    // The date the page defaulted to must be the one the guests were stamped
    // with, or a missing name below would mean "wrong day", not "wrong grouping".
    await expect(page.locator('#visitors-date').filter({ visible: true })).toHaveValue(sunday);

    const placements: Array<[typeof ALPHA, RegExp, string]> = [
      [ALPHA, BRAMPTON_1, 'Brampton · Level 1'],
      [ALPHA, SCARBOROUGH_A, 'Scarborough · Level A'],
      [BRAVO, BRAMPTON_4, 'Brampton · Level 4'],
      [BRAVO, SCARBOROUGH_C, 'Scarborough · Level C'],
    ];
    for (const [g, heading, label] of placements) {
      const section = group(page, heading);
      await expect(section, `no "${label}" group on the page`).toHaveCount(1);
      await expect(
        section.getByText(g.child),
        `${g.child} (grade ${g.grade}) is missing from ${label}`,
      ).toBeVisible();
    }

    // The N=2 claim, stated as exclusion: a page that simply listed every guest
    // under every class would satisfy the loop above and fail here.
    await expect(group(page, BRAMPTON_1).getByText(BRAVO.child)).toHaveCount(0);
    await expect(group(page, BRAMPTON_4).getByText(ALPHA.child)).toHaveCount(0);

    // Grade is shown per row so the desk can see why a child was placed there.
    await expect(group(page, BRAMPTON_1).getByText('Grade 1')).toBeVisible();
    await expect(group(page, BRAMPTON_4).getByText('Grade 6')).toBeVisible();

    // Nobody vanishes: a grade that matches no enabled class still surfaces.
    await expect(
      page.getByRole('heading', { level: 2, name: UNMATCHED }).filter({ visible: true }),
      'the unmatched bucket is absent, so a guest whose grade matches nothing was dropped',
    ).toBeVisible();
    await expect(group(page, UNMATCHED).getByText(CHARLIE.child)).toBeVisible();
    // ...and is NOT quietly filed under a class.
    await expect(group(page, BRAMPTON_1).getByText(CHARLIE.child)).toHaveCount(0);
  });

  test('the count is DISTINCT children, and the cross-centre caveat explains the duplicates', async ({ page }) => {
    await openVisitors(page);

    // 3 children produced 4 group rows. `childCount` must move by 3.
    expect(
      await childCount(page),
      'the headline count moved by the number of GROUP ROWS, not the number of children',
    ).toBe(baseline + 3);

    await expect(
      page
        .getByText(/listed under each, because the door does not record which centre they visited/)
        .filter({ visible: true }),
      'guests appear under two centres but the page never says why',
    ).toBeVisible();
  });

  test('each group links the desk into that class’s teacher screen for the same date', async ({ page }) => {
    await openVisitors(page);
    const link = group(page, BRAMPTON_1).getByRole('link', { name: /^Open class \(\d+\)$/ });
    await expect(link).toHaveAttribute(
      'href',
      `/teacher/levels/brampton-level-1-bv-brampton-2026-27/visitors?date=${sunday}`,
    );
  });
});
