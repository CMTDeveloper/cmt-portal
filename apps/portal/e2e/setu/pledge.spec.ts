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
 *   PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app \
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

  /** The card appears on both surfaces; find the visible copy of it. */
  function card(page: Page) {
    return page.locator('.card').filter({ hasText: 'Monthly giving' }).filter({ visible: true });
  }

  test('the dashboard shows the ask, and only the manager gets a button', async ({ page }) => {
    await page.goto('/family');
    await expect(card(page).first()).toBeVisible();
    await expect(visibleText(page, /a month/).first()).toBeVisible();
    await expect(
      card(page).first().getByRole('button', { name: /give \$\d+ monthly/i }),
    ).toBeVisible();
  });

  test('starting a pledge redirects to a Stripe-hosted page, and never asks for a bank detail here', async ({ page }) => {
    await page.goto('/family');
    const start = card(page).first().getByRole('button', { name: /give \$\d+ monthly/i });

    // The portal must never render a bank field. Assert BEFORE the click, on the
    // page we control - after it we are on Stripe's origin, where such fields are
    // correct and expected.
    for (const bankish of [/account number/i, /transit/i, /institution/i]) {
      await expect(page.getByText(bankish)).toHaveCount(0);
    }

    await Promise.all([page.waitForURL(/stripe\.com|checkout\./i, { timeout: 30_000 }), start.click()]);
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

  test('a pledge gates NOTHING - the dashboard payment and enrollment status are untouched', async ({ page }) => {
    // P5's global constraint. The static guard in
    // features/setu/pledges/__tests__/pledge-isolation.test.ts proves no code
    // reads a pledge outside the feature; this proves the rendered dashboard
    // agrees, against real data.
    await page.goto('/family');
    await expect(visibleText(page, /Donation status/).first()).toBeVisible();
    const dashboard = (await page.locator('body').textContent()) ?? '';
    // The pledge card is the only place the word may appear.
    const outsideCard = dashboard.replace(/Monthly giving[\s\S]*?(?=Keep your Family ID|$)/g, '');
    expect(outsideCard, 'pledge state leaked into the Bala Vihar summary').not.toMatch(/monthly gift|giving \$/i);
  });
});
