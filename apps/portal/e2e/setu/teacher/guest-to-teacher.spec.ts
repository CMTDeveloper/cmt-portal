import { test, expect, request, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { sessionDateFor } from '@cmt/shared-domain';
import { TEST_ACCOUNT_EMAILS, TEST_ACCOUNTS_PASSWORD, hasTestAccounts, hasFamilyCreds } from '../../_helpers';

/**
 * P2 Task 9 / spec §5.3 - the guest→teacher walk, end to end against DEPLOYED UAT,
 * and the acceptance test for Task 2's date-key fix.
 *
 * The gap this closes was named at `e2e/legacy/b1-kiosk.spec.ts:22`: nothing
 * anywhere submitted the real guest form and then checked that a teacher could
 * see the child. Task 2 fixed a live defect in exactly that seam (midweek guests
 * were invisible) with only unit coverage behind it.
 *
 * ── Two sessions, on purpose ────────────────────────────────────────────────────
 *   - the guest form (`/check-in/guest`, POST /api/check-in/guests) is gated to
 *     `isKiosk(claims) || isAdmin(claims)` (can-access-route.ts:40). The shared
 *     E2E family is family-manager + admin, so the `setu` project's default
 *     storageState is a legitimate door session.
 *   - the teacher side runs as `setu-test-teacher-brampton@…`, whose ONLY level is
 *     `brampton-level-1-bv-brampton-2025-26` (asserted in test-accounts.spec.ts).
 *     A narrow persona, not the admin: it proves a real teacher sees the guest
 *     rather than proving admin can see everything.
 *
 * ── Why the run day matters, and how this spec survives it ─────────────────────
 * `recordGuestCheckIn` reads the SERVER clock (guest-check-ins.ts:27) - the spec
 * cannot choose the guest's date. On a Sunday `date === sessionDate`, so a spec
 * that only submits the form and looks at today would pass even with the date-key
 * fix reverted.
 *
 * ⚠️ **The writer half below is NOT day-independent, and an earlier version of
 * this comment wrongly claimed it was.** `sessionDateFor` is a no-op on a Sunday
 * input, so on a Sunday run `expect(sessionDate).toBe(sessionDateFor(date))`
 * degenerates to `X === X`: a regression that skipped the helper and wrote
 * `sessionDate: ymd` verbatim - the whole original bug class - would satisfy it.
 * No assertion on the produced document can do better, because on a Sunday the
 * correct output and the naive output are byte-identical.
 *
 * The day-independent proof therefore lives where the clock CAN be controlled:
 * `features/check-in/shared/__tests__/guest-check-ins.test.ts` freezes the clock
 * to a Wednesday, a Saturday and a Monday and asserts `sessionDate !== date`.
 * Verified: reverting the writer to `sessionDate: ymd` fails those three.
 *
 * What this file pins, accurately:
 *   - the WRITER, on the six non-Sunday days: `sessionDate === sessionDateFor(date)`
 *     (test 1). Real coverage most of the week, tautological on Sundays.
 *   - the READER, on every day: a guest stamped with a deliberately MIDWEEK date
 *     is visible on the Sunday the teacher actually looks at - and the spec first
 *     proves that doc is invisible to the pre-fix `where('date','==',sunday)`
 *     query, so the fixture is known to distinguish the bug rather than merely
 *     coexist with it (test 2). This half is genuinely day-independent because
 *     the fixture supplies the differing dates itself.
 *
 * Read-only on the teacher side: the spec never clicks Confirm, so no pending
 * family, enrollment or guest mark is created. Cleanup is therefore just the
 * `guest_check_ins` docs it wrote.
 *
 * Run (deployed UAT only):
 *   PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app \
 *     pnpm --filter @cmt/portal exec playwright test --project=setu guest-to-teacher
 */

/** teacher-brampton's one and only level; gradeBand ['1'] in UAT. */
const LEVEL_ID = 'brampton-level-1-bv-brampton-2025-26';
/** A grade inside that level's band, so the guest matches it by grade alone. */
const GUEST_GRADE = '1';

/** Unique per run so re-runs never collide and cleanup can find its own rows. */
const RUN = Date.now().toString(36);
const DOOR_CHILD = `Doorguest ${RUN}`;
const MIDWEEK_CHILD = `Midweekguest ${RUN}`;
/** Grade 6 → Brampton Level 4, never Level 1. The control that turns "the panel
 *  lists door guests" into "the panel lists door guests FOR THIS CLASS". */
const OTHER_LEVEL_CHILD = `Otherlevelguest ${RUN}`;
const OTHER_LEVEL_GRADE = '6';
const DOOR_EMAIL = `e2e-guest-door-${RUN}@chinmayatoronto.org`;
const MIDWEEK_EMAIL = `e2e-guest-midweek-${RUN}@chinmayatoronto.org`;
const OTHER_LEVEL_EMAIL = `e2e-guest-other-${RUN}@chinmayatoronto.org`;

/** `ymd` shifted by whole days, in UTC (no DST hazard on a date-only value). */
function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The teacher layout renders its children TWICE (mobile branch + desktop branch),
 * so every node on the Visitors screen exists twice in the DOM. At Playwright's
 * default 1280px viewport the desktop copy is the visible one - filtering on
 * `visible: true` is what keeps these locators out of strict-mode violations.
 * Same reason `not-in-class.spec.ts` does it.
 */
function visibleCard(page: Page, text: string) {
  return page.locator('.card').filter({ hasText: text }).filter({ visible: true });
}

test.describe('guest check-in → teacher Visitors (deployed UAT)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required (the door session)');
  test.skip(!hasTestAccounts, 'TEST_ACCOUNTS_PASSWORD required (run seed:test-accounts first)');

  /** Every guest_check_ins doc this run created, removed in afterAll. */
  const writtenIds: string[] = [];
  /** The Sunday the teacher screens default to, taken from the doc the FORM wrote
   *  rather than re-derived from the local clock. */
  let sunday = '';

  let teacherState: Awaited<ReturnType<APIRequestContext['storageState']>>;

  test.beforeAll(async ({ baseURL }) => {
    // One sign-in for the whole file - the limiter is 5 per 15 minutes per email
    // (mint-password-session.ts:49). Empty jar so the persona never inherits the
    // shared family.json session, which belongs to a different account.
    const ctx = await request.newContext({ baseURL: baseURL!, storageState: { cookies: [], origins: [] } });
    try {
      const res = await ctx.post('/api/setu/auth/password-sign-in', {
        data: { email: TEST_ACCOUNT_EMAILS.teacherBrampton, password: TEST_ACCOUNTS_PASSWORD },
      });
      expect(
        res.status(),
        'rate-limited on the teacher persona: wait 15 minutes rather than re-running (5/15min per email)',
      ).not.toBe(429);
      expect(res.ok(), `teacher sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();
      teacherState = await ctx.storageState();
    } finally {
      await ctx.dispose();
    }
  });

  test.afterAll(async () => {
    if (writtenIds.length === 0) return;
    try {
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();
      for (const id of writtenIds) await db.collection('guest_check_ins').doc(id).delete();
    } catch (err) {
      // Loud, not silent: a leaked guest doc pollutes every later visitors run.
      console.warn('guest-to-teacher cleanup failed - remove these ids by hand:', writtenIds, err);
    }
  });

  async function teacherPage(browser: Browser, baseURL: string): Promise<{ close: () => Promise<void>; page: Page }> {
    const ctx = await browser.newContext({ baseURL, storageState: teacherState });
    return { page: await ctx.newPage(), close: () => ctx.close() };
  }

  test('a guest submitted at the door reaches the matching teacher, and is stamped with the session Sunday', async ({
    page,
    browser,
    baseURL,
  }) => {
    // ── (a) Submit the REAL form as the door session. ──────────────────────────
    await page.goto('/check-in/guest');
    await expect(
      page.getByRole('heading', { name: 'Guest check-in' }),
      'the guest form did not render - NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK must be true on the target deploy (flags.checkInKiosk gates both the page and the route)',
    ).toBeVisible({ timeout: 20_000 });

    await page.getByLabel('First name').fill('Doorguest');
    await page.getByLabel('Last name').fill(`Parent ${RUN}`);
    await page.getByLabel('Email').fill(DOOR_EMAIL);
    await page.getByLabel('Phone').fill('4165550100');
    await page.getByRole('button', { name: '+ Add child' }).click();
    await page.getByLabel('Child 1 name').fill(DOOR_CHILD);
    await page.getByLabel('Child 1 grade').selectOption(GUEST_GRADE);

    const [postRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/check-in/guests') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      page.getByRole('button', { name: 'Check in as guest' }).click(),
    ]);
    expect(postRes.status(), await postRes.text()).toBe(200);
    writtenIds.push(((await postRes.json()) as { id: string }).id);
    await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();

    // ── (b) The WRITER half of the date-key fix. ───────────────────────────────
    // `date` is the real Toronto walk-in day (server clock); `sessionDate` is the
    // Sunday every teacher surface defaults to. Asserting the relation - not a
    // hardcoded day - is what makes this hold on a Tuesday as well as a Sunday.
    const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
    const db = portalFirestore();
    const snap = await db.collection('guest_check_ins').doc(writtenIds[0]!).get();
    expect(snap.exists, 'the guest doc the route reported writing is not there').toBe(true);
    const written = snap.data() as { date?: string; sessionDate?: string; children?: Array<{ name?: string; grade?: string }> };
    expect(written.date, 'guest doc has no `date`').toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      written.sessionDate,
      'the guest doc must carry the session Sunday, or a midweek guest is invisible to every teacher screen',
    ).toBe(sessionDateFor(written.date!));
    expect(written.children).toEqual([{ name: DOOR_CHILD, grade: GUEST_GRADE }]);
    sunday = written.sessionDate!;

    // ── (c) The teacher, on the screen they actually open. ─────────────────────
    // NO ?date= - the default path is `mostRecentSunday()`, which is precisely
    // what made midweek guests vanish. The date is asserted first so a run that
    // straddles a Saturday→Sunday midnight fails with a legible reason instead of
    // a confusing "child missing".
    const t = await teacherPage(browser, baseURL!);
    try {
      await t.page.goto(`/teacher/levels/${LEVEL_ID}/visitors`);
      await expect(
        t.page.getByRole('heading', { name: 'Visitors' }).filter({ visible: true }),
        'the teacher visitors page did not render - is NEXT_PUBLIC_FEATURE_SETU_TEACHER=true on the target deploy?',
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        t.page.getByText(`Level 1 · ${sunday}`).filter({ visible: true }),
        'the teacher screen defaulted to a different session date than the guest was stamped with',
      ).toBeVisible();

      const row = visibleCard(t.page, DOOR_CHILD);
      await expect(row, 'the door guest never reached the teacher').toHaveCount(1, { timeout: 20_000 });
      // The grade is how the match was made, so it is part of the claim.
      await expect(row.getByText(`Grade ${GUEST_GRADE}`)).toBeVisible();
      // Unconfirmed guests are the queue the teacher works through.
      await expect(row.getByRole('button', { name: 'Confirm' })).toBeVisible();
    } finally {
      await t.close();
    }
  });

  test('a MIDWEEK guest is visible on the Sunday the teacher looks at (Task 2 date-key fix)', async ({
    browser,
    baseURL,
    request: adminRequest,
  }) => {
    expect(sunday, 'the previous test did not establish the session Sunday').toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Wednesday of the same session week. Deliberately NOT today: this is the one
    // assertion that must distinguish the bug on every day of the week.
    const midweek = addDays(sunday, 3);
    expect(sessionDateFor(midweek), 'fixture arithmetic: the midweek day must roll back to this Sunday').toBe(sunday);
    expect(midweek).not.toBe(sunday);

    const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
    const db = portalFirestore();

    /** A midweek guest doc, exactly the shape `recordGuestCheckIn` writes. */
    async function writeMidweekGuest(child: string, grade: string, email: string): Promise<string> {
      const ref = await db.collection('guest_check_ins').add({
        firstName: child.split(' ')[0],
        lastName: `Parent ${RUN}`,
        email,
        phone: '4165550101',
        numberOfAdults: 1,
        children: [{ name: child, grade }],
        numberOfChildren: 1,
        date: midweek,
        sessionDate: sunday,
        checkedInAt: new Date().toISOString(),
        _test: true,
      });
      writtenIds.push(ref.id);
      return ref.id;
    }

    const midweekId = await writeMidweekGuest(MIDWEEK_CHILD, GUEST_GRADE, MIDWEEK_EMAIL);
    // Same day, same source, a grade this level does NOT teach. Without it, a
    // panel that ignored `guestMatchesLevel` and listed every door guest would
    // satisfy every other assertion in this file.
    await writeMidweekGuest(OTHER_LEVEL_CHILD, OTHER_LEVEL_GRADE, OTHER_LEVEL_EMAIL);

    // Prove the fixture distinguishes the bug. The pre-fix reader was a single
    // `where('date','==',<the Sunday>)`; if this doc satisfied that, the assertion
    // below would pass with the fix reverted and prove nothing.
    const preFix = await db.collection('guest_check_ins').where('date', '==', sunday).get();
    expect(
      preFix.docs.some((d) => d.id === midweekId),
      'the midweek fixture is reachable by the OLD date-only query, so it cannot prove the fix',
    ).toBe(false);

    const t = await teacherPage(browser, baseURL!);
    try {
      await t.page.goto(`/teacher/levels/${LEVEL_ID}/visitors?date=${sunday}`);
      await expect(t.page.getByRole('heading', { name: 'Visitors' }).filter({ visible: true })).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        visibleCard(t.page, MIDWEEK_CHILD),
        'a guest who walked in midweek is invisible on the Sunday - the sessionDate leg of readPortalGuestChildren is not working',
      ).toHaveCount(1, { timeout: 20_000 });
      // Both grade-1 guests are on this level, so the Sunday view holds the week.
      await expect(visibleCard(t.page, DOOR_CHILD)).toHaveCount(1);
      // ...and the grade-6 guest, checked in on the same day, is somebody else's.
      await expect(
        visibleCard(t.page, OTHER_LEVEL_CHILD),
        `a Grade ${OTHER_LEVEL_GRADE} guest is on the Level 1 panel - the door list is not grade-matched to the class`,
      ).toHaveCount(0);
    } finally {
      await t.close();
    }

    // The absence above only means something if that child is genuinely IN the
    // day's data - otherwise a failed write, or a reader that returned nothing at
    // all, would satisfy it. So prove the positive on the class whose band DOES
    // hold Grade 6, through the same API the panel calls. Admin inherits teacher
    // and `canTeachLevel` lets it read any level (guard.ts:15), so the shared
    // session reaches Level 4 without a second persona sign-in.
    const elsewhere = await adminRequest.get(
      `/api/setu/teacher/visitors?levelId=brampton-level-4-bv-brampton-2026-27&date=${sunday}`,
    );
    expect(elsewhere.status(), await elsewhere.text()).toBe(200);
    const names = (
      (await elsewhere.json()) as { view: { doorVisitors: Array<{ name: string }> } }
    ).view.doorVisitors.map((g) => g.name);
    expect(
      names,
      `the Grade ${OTHER_LEVEL_GRADE} guest is missing from Level 4 too - it was never in the day's data, so its absence from Level 1 proved nothing`,
    ).toContain(OTHER_LEVEL_CHILD);
    expect(names, 'the grade-1 guests leaked into Level 4').not.toContain(MIDWEEK_CHILD);
  });
});
