import { test, expect, request as apiRequest, type Page, type APIRequestContext } from '@playwright/test';
// STATIC, not `await import(...)`. A dynamic import of this module dies under
// Playwright's loader with "./apps does not provide an export named
// getMasterApp" (#123). Every seed that used the dynamic form was silently
// broken, including its cleanup.
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { E2E_BASE_URL } from '../../_helpers';

/**
 * The welcome-desk payment view at `/welcome/family/[fid]`, against DEPLOYED UAT.
 *
 * ── Why this cannot be a unit test ──────────────────────────────────────────
 * The unit suite mocks `loadFamilyPaymentData` outright, so it proves the panels
 * render what they are handed and nothing about whether Firestore serves the
 * three queries, whether `use cache` / `connection()` behave, or whether the
 * welcome layout's role gate admits the persona. The thing this feature exists
 * to fix - a staff member answering a payment question - happens in a browser
 * against real data.
 *
 * ── The role split is the load-bearing assertion ────────────────────────────
 * The owner's rule is that welcome-team is roster + visitors, and that
 * off-portal payment is admin-only. Showing the VERDICT to a volunteer is
 * deliberate (they already read it as the roster's payment column); showing them
 * DOLLAR FIGURES is not. A unit test can assert that with a mocked session; only
 * this can assert it against the real gate, for the real roles, on the real page.
 *
 * ── Fixture: deliberately NOT an `active` pledge ────────────────────────────
 * An active pledge would flip the family's payment verdict to `paid`, on a REAL
 * UAT family that other specs read. The two seeded attempts are `failed` and
 * `cancelled`, which change no verdict but still exercise the part that matters
 * here: the provider's own error text, and N=2 history rows. `paidByPledge` is
 * covered by the unit suite, where flipping a verdict costs nobody anything.
 *
 * Run (deployed UAT only, never the whole setu suite - OTP limiter cascade):
 *     pnpm --filter @cmt/portal exec playwright test --project=setu family-payments
 */

const DOMAIN = 'chinmayatoronto.org';
const PASSWORD = process.env.TEST_ACCOUNTS_PASSWORD ?? '';
const ADMIN = `setu-test-admin@${DOMAIN}`;
/** Standalone welcome-team volunteer. */
const SEVAK = `setu-test-sevak@${DOMAIN}`;
/** Standalone coordinator - inherits welcome-team since 2026-08-05. */
const COORDINATOR = `setu-test-coordinator@${DOMAIN}`;

test.skip(!PASSWORD, 'TEST_ACCOUNTS_PASSWORD required (run seed:test-accounts first)');

const RUN = Date.now().toString(36);
const PROVIDER_ERROR = `/pad/monthly-subscription failed with 400: e2e-${RUN}`;

type Cookies = Awaited<ReturnType<APIRequestContext['storageState']>>['cookies'];
const cookieCache = new Map<string, Cookies>();

/**
 * Sign in ONCE per persona and cache the cookies. password-sign-in is limited to
 * 5 per 15 minutes and the limiter is SHARED across every spec, so signing in
 * per test trips it inside one file and later tests fail with a 429 that reads
 * like a broken fixture.
 */
async function cookiesFor(email: string): Promise<Cookies> {
  const cached = cookieCache.get(email);
  if (cached) return cached;
  const ctx: APIRequestContext = await apiRequest.newContext({ baseURL: E2E_BASE_URL });
  try {
    const res = await ctx.post('/api/setu/auth/password-sign-in', { data: { email, password: PASSWORD } });
    expect(res.ok(), `password-sign-in failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
    const { cookies } = await ctx.storageState();
    cookieCache.set(email, cookies);
    return cookies;
  } finally {
    await ctx.dispose();
  }
}

/**
 * The VISIBLE copy of some text.
 *
 * This page renders its whole body TWICE - once under `.block md:hidden` and
 * once under `.hidden md:block` - so every string exists twice in the DOM. At
 * Playwright's default 1280px viewport the MOBILE copy is the `display: none`
 * one, and a bare `.first()` resolves to exactly that: the first run of this
 * spec failed with "28 x locator resolved to <div>Programs & payment</div> -
 * unexpected value hidden", i.e. the feature worked and the locator did not.
 */
function visible(page: Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true }).first();
}

async function openFamilyAs(page: Page, email: string, fid: string): Promise<void> {
  await page.context().addCookies(await cookiesFor(email));
  await page.goto(`/welcome/family/${fid}`);

  // ── Say WHICH failure this is ──────────────────────────────────────────────
  // "element not found" has two very different causes here and the bare
  // assertion below cannot tell them apart: a gate bounced this persona to
  // another route, or the page rendered and the section is missing. The first
  // is an authorization finding, the second is a rendering bug, and they get
  // fixed in different files.
  //
  // Checked with Playwright rather than a status code on purpose: under
  // cacheComponents a `redirect()` in a page streams as the LAST BYTES of a 200
  // body, so the response status says nothing about whether a gate fired. The
  // landing URL is the only honest signal.
  await expect(page, `${email} was bounced away from the family page`).toHaveURL(
    new RegExp(`/welcome/family/${fid}`),
    { timeout: 30_000 },
  );

  // Access-denied renders INSTEAD of the body, with a 200 and the right URL, so
  // it would otherwise present as "the section is missing".
  await expect(
    page.getByText(/Access denied/i),
    `${email} reached the family page but was refused by the in-page role gate`,
  ).toHaveCount(0);

  await expect(
    visible(page, /Programs & payment/i),
    `the payment section never rendered for ${email}`,
  ).toBeVisible({ timeout: 30_000 });
}

let fid = '';
/** An active enrollment on `fid`, found during seeding. The settlement test
 *  needs one and there is no point re-querying for it. */
let activeEid = '';
const writtenDonations: string[] = [];
const writtenPledges: string[] = [];

test.beforeAll(async () => {
  // A REAL migrated family, so the enrollment rows are real ones with real
  // offerings - the case a seeded-from-nothing family would not reproduce.
  const ctx = await apiRequest.newContext({ baseURL: E2E_BASE_URL });
  try {
    await ctx.post('/api/setu/auth/password-sign-in', { data: { email: ADMIN, password: PASSWORD } });
    const res = await ctx.get('/api/welcome/roster/report?limit=40');
    expect(res.ok(), `roster report failed: ${res.status()}`).toBeTruthy();
    const rows = ((await res.json()) as { rows?: Array<{ fid?: string }> }).rows ?? [];
    const candidates = rows.map((r) => r.fid).filter((f): f is string => Boolean(f));
    expect(candidates.length, 'no family in the UAT roster to read').toBeGreaterThan(0);

    // ── Pick a family that is actually ENROLLED ────────────────────────────────
    // The first draft took `rows[0]` and the first run drew CMT-G7XQ03YX, which
    // has no active enrollment - so the settlement test had nothing to settle and
    // the other tests were exercising an empty programs list, i.e. the least
    // realistic fixture available on a page about enrollments and payments.
    //
    // Probed per family against its own subcollection, NOT
    // `collectionGroup('enrollments').where('status','==','active')` - that query
    // needs an `enrollments.status` COLLECTION_GROUP field override which this
    // project does not have, and its absence is what made /welcome/levels 500 on
    // every request for weeks (#97). A single-field where on ONE family's
    // subcollection is auto-indexed and costs nothing.
    const db = portalFirestore();
    for (const candidate of candidates) {
      const snap = await db
        .collection('families')
        .doc(candidate)
        .collection('enrollments')
        .where('status', '==', 'active')
        .limit(1)
        .get();
      if (!snap.empty) {
        fid = candidate;
        activeEid = snap.docs[0]!.id;
        break;
      }
    }
    expect(fid, 'no family in the first 40 roster rows has an active enrollment').toBeTruthy();
  } finally {
    await ctx.dispose();
  }

  const db = portalFirestore();

  // N=2 donations: one the browser confirmed, one that never came back. The
  // second is the row a family phones about ("I paid, why does it say I did
  // not?"), so it is the one whose copy has to be right.
  for (const [i, status] of (['completed', 'redirected'] as const).entries()) {
    const ref = db.collection('donations').doc();
    await ref.set({
      did: ref.id,
      fid,
      donorMid: `${fid}-01`,
      donorName: `E2E Payments ${RUN}`,
      donorEmail: `e2e-${RUN}@example.com`,
      type: 'enrollment',
      programKey: 'bala-vihar',
      programLabel: 'Bala Vihar',
      pid: null,
      eid: null,
      label: `E2E ${RUN} donation ${i + 1}`,
      // Deliberately tiny. This sums into the family's LIFETIME donation total
      // (#117), and a realistic amount could tip a real UAT family's verdict
      // from outstanding to paid for other specs reading the same roster.
      amountCAD: 1,
      coverFee: false,
      feeCAD: 0,
      clientReferenceId: `E2E-${RUN}-${i}`,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
      _test: true,
    });
    writtenDonations.push(ref.id);
  }

  // N=2 pledge attempts, neither of which changes the payment verdict. The
  // failed one carries the provider's own words - the single most useful thing
  // on the page for a failed-payment enquiry, and the thing that was captured in
  // Firestore and shown to nobody until now.
  const attempts = [
    { status: 'failed', lastError: PROVIDER_ERROR, startedAt: new Date('2026-01-10T00:00:00Z') },
    { status: 'cancelled', lastError: null, startedAt: new Date('2026-03-01T00:00:00Z') },
  ];
  for (const a of attempts) {
    const ref = db.collection('pledges').doc();
    await ref.set({
      pid: ref.id,
      fid,
      monthlyAmountCAD: 108,
      status: a.status,
      startedAt: a.startedAt,
      activatedAt: null,
      cancelledAt: a.status === 'cancelled' ? new Date('2026-03-20T00:00:00Z') : null,
      startedByMid: `${fid}-01`,
      lastError: a.lastError,
      _test: true,
    });
    writtenPledges.push(ref.id);
  }
});

test.afterAll(async () => {
  // Belt and braces. These rows sit on a REAL UAT family; leaving a pledge or a
  // donation behind changes what every other spec reads about them.
  const db = portalFirestore();
  await Promise.all([
    ...writtenDonations.map((id) => db.collection('donations').doc(id).delete().catch(() => {})),
    ...writtenPledges.map((id) => db.collection('pledges').doc(id).delete().catch(() => {})),
  ]);
});

test.describe('/welcome/family/[fid] - the payment answer (deployed UAT)', () => {
  test.describe.configure({ mode: 'serial' });

  /**
   * Settlement provenance, walked through the REAL write route and undone the
   * same way.
   *
   * ── Why this test exists ────────────────────────────────────────────────────
   * The provenance path had zero deployed coverage, and that is exactly where a
   * crash hid: `settledAt` is written by `FieldValue.serverTimestamp()` and read
   * back through `rawToEnrollment`, which converts timestamps FIELD BY FIELD and
   * spreads the rest raw. A Firestore `Timestamp` has no `toLocaleDateString`,
   * so the page threw server-side - but only for families settled AFTER the
   * deploy, which is why every walkthrough on existing data looked healthy.
   * A unit test now pins the conversion; this proves the whole round trip.
   *
   * ── Why the API, not a raw Firestore write ──────────────────────────────────
   * Settling via `PATCH .../override` exercises the actual write (including the
   * audit row and the provenance stamp), and the undo - `suggestedAmountOverride:
   * null` - is the same route's own reversal, which CLEARS the fields. A raw
   * write would test less and leave more behind on a shared UAT family.
   */
  test('a settled enrollment renders its provenance instead of crashing', async ({ page }) => {
    const admin = await apiRequest.newContext({ baseURL: E2E_BASE_URL });
    let eid: string | null = null;
    try {
      await admin.post('/api/setu/auth/password-sign-in', { data: { email: ADMIN, password: PASSWORD } });
      // `activeEid` was resolved during seeding, against Firestore.
      //
      // The first draft fetched `/api/welcome/families/{fid}/enrollments` and
      // did `test.skip(!res.ok())`. That route does not exist - so the test
      // would have skipped on every run forever while reading like coverage.
      // This repo already has one spec that has been silently self-skipping
      // since the day it shipped (#69); it does not need a second.
      eid = activeEid;

      const settle = await admin.patch(`/api/welcome/enrollments/${eid}/override`, {
        data: { suggestedAmountOverride: 0, note: `E2E ${RUN} provenance probe` },
        failOnStatusCode: false,
      });
      expect(settle.status(), await settle.text()).toBe(200);

      await openFamilyAs(page, ADMIN, fid);
      // The render that used to throw.
      await expect(visible(page, /Recorded by/)).toBeVisible();
      await expect(visible(page, new RegExp(`E2E ${RUN} provenance probe`))).toBeVisible();
    } finally {
      if (eid) {
        await admin.patch(`/api/welcome/enrollments/${eid}/override`, {
          data: { suggestedAmountOverride: null, note: `E2E ${RUN} undo` },
          failOnStatusCode: false,
        });
      }
      await admin.dispose();
    }
  });

  test('an ADMIN sees the donation history, both statuses distinguished', async ({ page }) => {
    await openFamilyAs(page, ADMIN, fid);

    await expect(visible(page, /Payment activity/i)).toBeVisible();
    // The distinction that stops a family being told they never paid.
    await expect(visible(page, /Completed \(confirmed at the Stripe return page\)/)).toBeVisible();
    await expect(visible(page, /Started - never confirmed back to the portal/)).toBeVisible();
  });

  test("an ADMIN sees the payment service's own error words", async ({ page }) => {
    // The whole "transaction history of stripe feedback" ask, in one assertion.
    await openFamilyAs(page, ADMIN, fid);
    await expect(visible(page, PROVIDER_ERROR)).toBeVisible();
  });

  test('an ADMIN is told what Stripe knows that the portal does not', async ({ page }) => {
    // Without this an admin reading a complete-looking history concludes a
    // family never paid, when the truth is refunds and monthly debits are simply
    // never sent to us.
    await openFamilyAs(page, ADMIN, fid);
    await expect(visible(page, /is not sent to the portal/i)).toBeVisible();
  });

  for (const [label, email] of [
    ['welcome-team volunteer', SEVAK],
    ['coordinator', COORDINATOR],
  ] as const) {
    test(`a ${label} sees the programs but NO money and NO activity`, async ({ page }) => {
      await openFamilyAs(page, email, fid);

      // They DO get the section and the verdict - that is the point of the
      // change, and the verdict is already theirs on the roster.
      await expect(visible(page, /Programs & payment/i)).toBeVisible();

      // ...and none of the admin-only half.
      //
      // These stay UNFILTERED by visibility, unlike the positive assertions
      // above, and the difference is deliberate. "Must not see" is a question
      // about what the SERVER SENT: a hidden element is still in the HTML the
      // volunteer's browser received, so `toHaveCount(0)` over the whole DOM is
      // the honest test and `visible: true` would pass on a real leak.
      await expect(page.getByText(/Payment activity/i)).toHaveCount(0);
      await expect(page.getByText(PROVIDER_ERROR)).toHaveCount(0);
      await expect(page.getByText(/Expected \$/)).toHaveCount(0);
      await expect(page.getByText(/received \$/)).toHaveCount(0);
      // The write control stays admin-only too (unchanged by this feature, and
      // worth re-pinning here because it now sits under the same heading area).
      await expect(page.getByText(/Record an off-portal donation/i)).toHaveCount(0);
    });
  }
});
