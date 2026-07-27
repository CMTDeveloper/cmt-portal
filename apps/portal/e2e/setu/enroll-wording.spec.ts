import { test, expect, type Page } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';

/**
 * Wording on the money-facing screens: a donation is never described as a fee,
 * and a free program is never described as one whose donation is "coming soon".
 *
 * ── WHY NOTHING HERE NAMES A SCHOOL YEAR (fixed 2026-07-27) ─────────────────
 * This spec used to navigate to a literal
 * `/family/donate?eid=CMT-FSWEDU2X-bv-brampton-2025-26`. The annual rollover
 * CANCELS the source enrollment and creates the next year's, so that eid is now
 * a cancelled row and the donate page had nothing to render - a stale fixture
 * reported as a wording regression. The eid is now read from the family's own
 * enrollments, so the spec follows the family through every rollover.
 */
test.describe('enroll page wording', () => {
  test.skip(!hasFamilyCreds, 'E2E family creds required');

  /** The family's ACTIVE Bala Vihar enrollment id, whatever year it belongs to. */
  async function activeBvEid(page: Page): Promise<string | undefined> {
    const res = await page.request.get('/api/setu/enrollments', { timeout: 30_000 });
    expect(res.ok(), `could not read enrollments: ${res.status()}`).toBeTruthy();
    const body = (await res.json()) as
      | { enrollments?: { eid: string; programKey: string; status: string }[] }
      | { eid: string; programKey: string; status: string }[];
    const rows = Array.isArray(body) ? body : (body.enrollments ?? []);
    // By programKey, never "the first active one" - a second active enrollment
    // in another program would otherwise hijack this assertion.
    return rows.find((e) => e.programKey === 'bala-vihar' && e.status === 'active')?.eid;
  }

  test('the Bala Vihar donation page calls the donation a donation, and never a fee', async ({ page }) => {
    const eid = await activeBvEid(page);
    test.skip(!eid, 'the seeded family has no active Bala Vihar enrollment');

    await page.goto(`/family/donate?eid=${eid}`);
    await expect(visibleText(page, /Your donation/i).first()).toBeVisible();
    // The charity-status paragraph, which is the whole point: a family must not
    // read a suggested donation as a price of admission.
    await expect(visibleText(page, /not a fee/i).first()).toBeVisible();
  });

  test('no enroll page promises a donation that is "coming soon", and none 404s', async ({ page }) => {
    // This used to hardcode `/family/enroll/om-chanting`. That program has since
    // been DEACTIVATED, and the enroll page calls notFound() for an inactive
    // program - so the spec was asserting wording on a 404 page. Rather than
    // name another program that can be switched off next month, walk whatever is
    // actually live and assert the invariant on each of them.
    const res = await page.request.get('/api/setu/programs', { timeout: 30_000 });
    expect(res.ok(), `could not list programs: ${res.status()}`).toBeTruthy();
    const body = (await res.json()) as { programs?: { programKey: string }[] };
    const keys = (body.programs ?? []).map((p) => p.programKey);
    expect(keys.length, 'no active programs at all - the roster would be empty').toBeGreaterThan(0);

    for (const key of keys) {
      await page.goto(`/family/enroll/${key}`);

      // A program the API advertises as available must have a reachable enroll
      // page. A 404 here is a dead end a family can actually click into from
      // /family/programs.
      await expect(
        page.getByRole('heading', { name: /Page not found/i }),
        `/family/enroll/${key} 404s, but /api/setu/programs lists it`,
      ).toHaveCount(0);

      // Holds for EVERY program: with online donations enabled, no page may tell
      // a family a donation is "coming soon" - that copy is the pre-online-giving
      // state and reads as "we will bill you later", which is never true now.
      await expect(page.getByText(/donation coming soon/i), key).toHaveCount(0);

      // The rest applies ONLY to a program with no donation. "Proceed to donate
      // below" is CORRECT on Bala Vihar and appears there four times - asserting
      // it absent everywhere was my error, not the product's. Tie the assertion
      // to the state it was written for: if the page says there is no donation
      // requirement, it must not then point at a donate block.
      const noDonationCopy = visibleText(page, /no donation requirement/i);
      if ((await noDonationCopy.count()) > 0) {
        await expect(noDonationCopy.first()).toBeVisible();
        await expect(page.getByText(/Proceed to donate below/i), key).toHaveCount(0);
      }
    }
  });
});
