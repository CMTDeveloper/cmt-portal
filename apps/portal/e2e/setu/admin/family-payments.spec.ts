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
  await expect(
    visible(page, /Programs & payment/i),
    `the payment section never rendered for ${email}`,
  ).toBeVisible({ timeout: 30_000 });
}

let fid = '';
const writtenDonations: string[] = [];
const writtenPledges: string[] = [];

test.beforeAll(async () => {
  // A REAL migrated family, so the enrollment rows are real ones with real
  // offerings - the case a seeded-from-nothing family would not reproduce.
  const ctx = await apiRequest.newContext({ baseURL: E2E_BASE_URL });
  try {
    await ctx.post('/api/setu/auth/password-sign-in', { data: { email: ADMIN, password: PASSWORD } });
    const res = await ctx.get('/api/welcome/roster/report?limit=5');
    expect(res.ok(), `roster report failed: ${res.status()}`).toBeTruthy();
    const rows = ((await res.json()) as { rows?: Array<{ fid?: string }> }).rows ?? [];
    const target = rows.find((r) => r.fid)?.fid;
    expect(target, 'no family in the UAT roster to read').toBeTruthy();
    fid = target!;
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
