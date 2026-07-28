import { test, expect, type Page } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';

/**
 * ⚠️ OWNER-GATED, and NOT YET RUN - deployed-UAT E2E for the monthly pledge
 * (P5 v3 Tasks 3-7). Authored under Task 8. Gated the same way, and for the same
 * reason, as `adult-class.spec.ts` and `kiosk-auto-enroll.spec.ts`.
 *
 * ── 🔴 WHY THIS ONE IS GATED HARDER THAN THE OTHERS ─────────────────────────
 * The other gated specs need a flag. This one needs a flag **and** a payment
 * service. `/pad/*` is Stripe **TEST** mode today; the flag flip is the thing
 * that makes the next family's mandate REAL. So:
 *   - flip the flag on **UAT ONLY**, never production;
 *   - the amount actually debited lives on the Stripe Price, NOT in this repo.
 *     Nothing here can detect a wrong one. Open the Stripe dashboard.
 *
 * ── PRECONDITIONS, in order ─────────────────────────────────────────────────
 *   1. The branch DEPLOYED to UAT (https://cmt-setu.vercel.app) with
 *      `NEXT_PUBLIC_FEATURE_SETU_PLEDGE=true`. The flag is `NEXT_PUBLIC_*`, so
 *      it is statically inlined - an env-only change does nothing without a
 *      rebuild. With it off, every route below returns 404 and every assertion
 *      fails on the flag rather than on the feature.
 *   2. `STRIPE_API_BASE_URL` and `STRIPE_PLEDGE_PRICE_ID` set on UAT, pointing
 *      at the TEST price. `PLEDGE_MONTHLY_AMOUNT_CAD` may be left at its default.
 *   3. `/pad/setup-link`, `/checkout-session-result`, `/pad/monthly-subscription`
 *      and `/subscription-result` confirmed live on the payment service.
 *   4. `.env.local` carries E2E_FAMILY_EMAIL + E2E_FAMILY_PASSWORD, and
 *      CRON_SECRET for the reconciler phase.
 *
 * Run (deployed UAT only - never prod):
 *     pnpm --filter @cmt/portal exec playwright test --project=setu pledge
 *
 * ── WHAT IS AUTOMATED, AND WHAT IS NOT ──────────────────────────────────────
 * Authorising the mandate happens on a page Stripe owns. Driving that form would
 * couple this suite to a third party's DOM and break on their next redesign, so
 * it is a MANUAL step, marked below. Everything on both sides of it is checked:
 * the ask, the redirect, the `started` state and its careful copy, the return
 * leg, and the reconciler. That split is deliberate - see the phase comments.
 *
 * ── WHY A BROWSER ───────────────────────────────────────────────────────────
 * The card renders inside a page that ships mobile and desktop markup side by
 * side (`.block md:hidden` + `.hidden md:block`), so EVERY locator here needs
 * `.filter({ visible: true })` - `visibleText` does that. Unit tests render one
 * copy and cannot see the doubling. And the redirect to a third-party origin is
 * a hard navigation no mock reproduces.
 */

const RUN_E2E = hasFamilyCreds;

test.describe('monthly pledge', () => {
  test.skip(!RUN_E2E, 'needs E2E_FAMILY_EMAIL + E2E_FAMILY_PASSWORD');

  /**
   * ── LEAVE NO LIVE PLEDGE BEHIND ───────────────────────────────────────────
   * The redirect test starts a real pledge, and `startPledge` refuses a second
   * one while the first is `started`. So a green run poisons the NEXT run: on
   * 2026-07-28 the redirect test failed for 40s against a leftover pledge from
   * a previous session, and read as a broken payment integration.
   *
   * Cancelling is the same remedy the failure message recommends, and the same
   * one an admin has in the UI, so this exercises a real route rather than
   * reaching into Firestore behind the product's back. Best-effort: a cleanup
   * that throws would turn a passing run red for a housekeeping detail.
   */
  test.afterAll(async ({ playwright, baseURL }) => {
    if (!RUN_E2E) return;
    const ctx = await playwright.request.newContext({
      baseURL: baseURL!,
      storageState: 'e2e/.auth/family.json',
    });
    try {
      const res = await ctx.post('/api/pledges/start', { data: {} });
      // 409 already-started names the live pledge; 201 means we just made one.
      const body = (await res.json()) as { pid?: string };
      if (body.pid) await ctx.post(`/api/admin/pledges/${body.pid}/cancel`, { data: {} });
    } catch {
      // Best effort - never fail a green run on cleanup.
    } finally {
      await ctx.dispose();
    }
  });

  /** The card appears on both surfaces; find the visible copy of it. */
  function card(page: Page) {
    return page.locator('.card').filter({ hasText: 'Monthly giving' }).filter({ visible: true });
  }


  /** The family's ACTIVE Bala Vihar enrollment id - the donate flow's target. */
  async function activeBvEid(page: Page): Promise<string | undefined> {
    const res = await page.request.get('/api/setu/enrollments', { timeout: 30_000 });
    expect(res.ok(), `could not read enrollments: ${res.status()}`).toBeTruthy();
    const body = (await res.json()) as
      | { enrollments?: { eid: string; programKey: string; status: string }[] }
      | { eid: string; programKey: string; status: string }[];
    const rows = Array.isArray(body) ? body : (body.enrollments ?? []);
    return rows.find((e) => e.programKey === 'bala-vihar' && e.status === 'active')?.eid;
  }

  test('starting a pledge redirects to a Stripe-hosted page, and never asks for a bank detail here', async ({ page }) => {
    // The button moved from the dashboard into the Bala Vihar donate flow on
    // 2026-07-27 - the monthly plan is one of two ways to pay THIS donation, so
    // the click starts where the family is making that choice.
    const bvEid = await activeBvEid(page);
    test.skip(!bvEid, 'the seeded family has no active Bala Vihar enrollment');
    await page.goto(`/family/donate?eid=${bvEid}`);
    const start = page.getByRole('button', { name: /give \$\d+ monthly/i }).filter({ visible: true }).first();
    await expect(start, 'the monthly option is missing from the donate flow').toBeVisible({ timeout: 20_000 });

    // The portal must never render a bank field. Assert BEFORE the click, on the
    // page we control - after it we are on Stripe's origin, where such fields are
    // correct and expected.
    for (const bankish of [/account number/i, /transit/i, /institution/i]) {
      await expect(page.getByText(bankish)).toHaveCount(0);
    }

    // The CLICK is the test - do not pre-call the API here. `startPledge` blocks
    // a second pledge while one is `started`, so probing first would make the
    // click 409 and never redirect: the probe would break the very path it is
    // meant to observe.
    // 20s, NOT 30s. The classifier below is the whole point of this try/catch,
    // and with a 30s wait inside a 30s test budget it can never run: on
    // 2026-07-28 both timers expired together, Playwright killed the test, and
    // the report said "waiting for navigation until load" - the exact useless
    // message this block was written to replace. The real cause was a 409
    // already-started, which the catch would have named in one line.
    test.setTimeout(60_000);
    try {
      await Promise.all([page.waitForURL(/stripe\.com|checkout\./i, { timeout: 20_000 }), start.click()]);
    } catch (navFailed) {
      // ONLY on failure, ask the API to classify what went wrong. Waiting on the
      // navigation alone yields "waiting for navigation until load" and nothing
      // else - which is exactly what the first real run produced, while the true
      // cause was the payment service answering 404 for `/pad/setup-link`
      // because `/pad/*` was not deployed. One extra pledge row is a fair price
      // on a path that has already failed.
      const probe = await page.request.post('/api/pledges/start', { data: {} });
      const status = probe.status();
      if (status === 503) {
        throw new Error(
          'The button is fine - the payment service is not. POST /api/pledges/start returned 503 ' +
            'provider-unavailable. Check STRIPE_API_BASE_URL / STRIPE_PLEDGE_PRICE_ID on the ' +
            'deployment and confirm /pad/* is actually deployed. The route never echoes provider ' +
            'detail, so the precise error is on the newest `pledges` document in `lastError`.',
        );
      }
      if (status === 409) {
        throw new Error(
          'This family already has a live pledge from an earlier run, so the donate page shows ' +
            'the plan rather than an ask and the button was never there to click. Cancel it via ' +
            'POST /api/admin/pledges/[pid]/cancel, or let the reconciler settle it, then re-run.',
        );
      }
      throw navFailed;
    }
    // A third-party origin. Assert the host and stop - the mandate form is
    // Stripe's, and driving it would couple this suite to their DOM.
    expect(page.url()).toMatch(/stripe\.com|checkout\./i);
  });

  test('back on the dashboard, an unfinished pledge says so WITHOUT claiming success', async ({ page }) => {
    // The state a family is in the moment they abandon or complete the hosted
    // page. This is the assertion the whole feature turns on: a pre-authorized
    // debit can fail days later, and a family told "thank you, you're giving"
    // would never look again.
    await page.goto('/family');
    const body = card(page).first();
    await expect(body).toBeVisible();

    const text = (await body.textContent()) ?? '';
    if (/setting up your monthly gift/i.test(text)) {
      expect(text, 'the started state claims the gift is working').not.toMatch(/you.re giving|thank you/i);
      // And no second start button, which would risk a SECOND authorised mandate.
      await expect(body.getByRole('button', { name: /give \$\d+ monthly/i })).toHaveCount(0);
    }
  });

  /**
   * ── MANUAL STEP ───────────────────────────────────────────────────────────
   * Between the test above and the one below, authorise the mandate on Stripe's
   * hosted page using Stripe TEST banking details, and let it return you to
   * `/donate/success?pledge=<pid>`. That page finalizes server-side.
   *
   * Then confirm, in the UAT Firestore console, that the `pledges/{pid}` document
   * contains NO bank-ish field - only status, timestamps, the snapshotted amount,
   * and the opaque `setupSessionId` / `subscriptionId` / `customerId` handles.
   */

  test('the reconciler runs, is authenticated, and reports counts', async ({ request }) => {
    const secret = process.env.CRON_SECRET;
    test.skip(!secret, 'needs CRON_SECRET to invoke the cron route');

    // Unauthenticated first: the route must not be open just because it is a cron.
    const denied = await request.get('/api/cron/reconcile-pledges');
    expect(denied.status(), 'the reconciler cron is reachable without the secret').toBe(401);

    const res = await request.get('/api/cron/reconcile-pledges', {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.ok(), `reconciler failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    const json = (await res.json()) as Record<string, unknown>;
    // `disabled: true` here means the flag is OFF on the deploy - the run proved
    // the route exists and is guarded, but nothing about the feature.
    expect(json).toHaveProperty('success', true);
    expect(json, 'the pledge flag is OFF on this deploy - see the preconditions').not.toHaveProperty('disabled', true);
    expect(json).toHaveProperty('scanned');
  });

  // ── REVERSED 2026-07-27 ────────────────────────────────────────────────────
  // This test used to assert "a pledge gates NOTHING - the dashboard payment and
  // enrollment status are untouched", which was P5's global constraint. Vaibhav
  // then established that the monthly plan is not a separate ask but the SECOND
  // way to pay the Bala Vihar donation, so a pledge is now SUPPOSED to move
  // exactly the signals this test guarded. Left in place, it would have failed
  // the moment the feature worked - and the temptation would have been to delete
  // it. The replacement asserts the NEW rule, and the isolation invariant lives
  // on as an allowlist in pledge-isolation.test.ts.
  test('the dashboard never shows a monthly ASK next to a Not-enrolled status', async ({ page }) => {
    // The regression that prompted the whole change: the standalone card offered
    // "$51 monthly" to families whose own dashboard read "Not enrolled" - an
    // invitation to fund a programme they had not joined. The ask now lives in
    // the Bala Vihar donate flow; the dashboard may report an EXISTING plan, but
    // must never solicit a new one.
    await page.goto('/family');
    // Gate on the Bala Vihar card HEADING, not on the "Donation status" label.
    // The dashboard renders that label inside a block Playwright does not count
    // as visible, so the old gate timed out for 20s on a page that had rendered
    // perfectly well - a load gate reporting a product fault. The heading is the
    // same signal (the card is on screen) and is unambiguously visible.
    //
    // 20s, not the 5s default: /family streams under PPR and every other
    // dashboard assertion in this suite allows for that.
    await expect(
      page.getByRole('heading', { name: /bala vihar/i }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole('button', { name: /give \$\d+ monthly/i }),
      'the dashboard is soliciting a monthly plan - that ask belongs on /family/donate',
    ).toHaveCount(0);
  });

  test('the monthly option is offered inside the Bala Vihar donate flow', async ({ page }) => {
    // Where the choice belongs: one decision - how to pay this year's Bala Vihar
    // contribution - with both answers in front of the family at once.
    const bvEid = await activeBvEid(page);
    test.skip(!bvEid, 'the seeded family has no active Bala Vihar enrollment');

    await page.goto(`/family/donate?eid=${bvEid}`);
    // The one-time path is still the primary action...
    await expect(visibleText(page, /Your donation/i).first()).toBeVisible();
    // ...and the instalment alternative sits beside it, saying plainly that it
    // does not stop on its own. That sentence is the honesty requirement: a
    // family who believes a bank debit ends by itself has been misled.
    await expect(visibleText(page, /a month instead/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(visibleText(page, /continues until you stop it/i).first()).toBeVisible();
  });
});
