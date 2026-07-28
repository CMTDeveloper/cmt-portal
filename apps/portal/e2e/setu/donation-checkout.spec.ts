import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../_helpers';

/**
 * The one-time donation checkout, end to end against the deployed app.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * This is the path a family walks to PAY for Bala Vihar, and until 2026-07-27 it
 * had no end-to-end test at all. Other specs assert donation *wording* and
 * donation-derived *state*; none of them ever asked the payment service for a
 * checkout link. That gap was not theoretical: the pledge flow was found 503ing
 * because its Cloud Run host did not exist, and the same host is the one named
 * by `STRIPE_CHECKOUT_URL`. Nothing in the suite would have noticed if donations
 * had gone down with it.
 *
 * ── WHAT IT ACTUALLY PROVES ─────────────────────────────────────────────────
 * That the deployment's Stripe config resolves to a LIVE service and that the
 * service returns a usable hosted-checkout URL. Mocks cannot show this: the
 * failure mode is a stale hostname in an env var, which is invisible to every
 * unit test and to `vercel env pull` (sensitive vars pull back as empty
 * strings). Only asking the running deployment settles it.
 *
 * ── THE MODE ASSERTION IS THE POINT ─────────────────────────────────────────
 * A checkout session id is prefixed `cs_test_` or `cs_live_`, and that prefix is
 * the ONLY thing here that can tell a real payment from a rehearsal. On
 * 2026-07-27 production was returning `cs_test_` - working, but no money would
 * move. Set `E2E_EXPECT_STRIPE_MODE=live` as part of go-live and this fails
 * loudly if the deployment is still pointed at the test service.
 *
 * Run (deployed target only):
 *     pnpm --filter @cmt/portal exec playwright test --project=setu donation-checkout
 */

/** 'test' until someone deliberately flips it at go-live. */
const EXPECT_MODE = process.env.E2E_EXPECT_STRIPE_MODE === 'live' ? 'live' : 'test';

test.describe('one-time donation checkout', () => {
  test.skip(!hasFamilyCreds, 'needs E2E_FAMILY_EMAIL + E2E_FAMILY_PASSWORD');

  test('a manager gets a Stripe-hosted checkout URL, in the expected Stripe mode', async ({
    request,
  }) => {
    // $1 general donation: the smallest request that exercises the whole path.
    // `general` deliberately, NOT `enrollment` - an enrollment donation is
    // subject to the suggested-amount floor and would couple this test to
    // whatever the current offering asks for.
    const res = await request.post('/api/setu/donations/checkout', {
      data: { type: 'general', amountCAD: 1, coverFee: false },
      headers: { origin: new URL(test.info().project.use.baseURL!).origin },
    });

    // 502 = the route reached the payment service and it refused. 503 = the
    // portal's own Stripe env is unset. Both are config, not code, so say which.
    expect(
      res.status(),
      res.status() === 502
        ? 'the payment service rejected the checkout - STRIPE_CHECKOUT_URL almost certainly points at a host that no longer exists. Probe it: POST <BASE>/checkout-link with an empty body returns 400 on the right host and 404 on the wrong one.'
        : res.status() === 503
          ? 'STRIPE_CHECKOUT_URL / STRIPE_API_KEY are not set on this deployment.'
          : `unexpected status: ${await res.text()}`,
    ).toBe(200);

    const body = (await res.json()) as { url?: string; did?: string };
    expect(body.url, 'no checkout url returned').toBeTruthy();
    expect(body.url!).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    // The prefix is the mode. Assert it explicitly rather than just "a session
    // exists" - a test-mode session is indistinguishable from a live one by
    // every other signal on this page, including the family's own eyes.
    const mode = /cs_live_/.test(body.url!) ? 'live' : /cs_test_/.test(body.url!) ? 'test' : 'unknown';
    expect(
      mode,
      `Stripe returned a ${mode}-mode session but E2E_EXPECT_STRIPE_MODE=${EXPECT_MODE}. ` +
        (EXPECT_MODE === 'live'
          ? 'The deployment is still on the TEST checkout service - families would complete a payment that never moves money. Check STRIPE_USE_TEST_CHECKOUT.'
          : 'Set E2E_EXPECT_STRIPE_MODE=live once production is switched over.'),
    ).toBe(EXPECT_MODE);

    // Clean up after ourselves: the route wrote a `redirected` donation, and the
    // cancel page is the product's own way of retiring one. Left alone it is
    // harmless (`donations-sum` counts only `completed`), but a family's
    // donation history should not accumulate a $1 row per CI run.
    if (body.did) {
      const cancel = await request.get(`/family/donate/cancel?did=${body.did}`);
      expect(cancel.ok(), 'the cancel leg should retire an abandoned donation').toBeTruthy();
    }
  });

  test('the checkout route refuses a caller with no session', async ({ playwright }) => {
    // A payment-initiating route must not be open.
    //
    // `storageState` MUST be passed explicitly empty. Omitting it does NOT give
    // you an anonymous context - the suite's saved family session comes along,
    // and the request succeeds. That produced a 200 here and read as "the
    // checkout route answers anonymous callers", which would have been an
    // alarming and completely false security finding. A plain `curl` with no
    // cookie returns 401, as the route's code says it should.
    const anon = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL!,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const res = await anon.post('/api/setu/donations/checkout', {
        data: { type: 'general', amountCAD: 1, coverFee: false },
      });
      expect(res.status(), 'donations checkout answered an unauthenticated caller').toBe(401);
    } finally {
      await anon.dispose();
    }
  });
});
