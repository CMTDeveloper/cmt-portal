import { test, expect, request as apiRequest } from '@playwright/test';
import { E2E_BASE_URL } from './_helpers';

/**
 * Every path-to-path redirect must be a REAL HTTP redirect.
 *
 * Task #114. `/welcome` was a `page.tsx` whose whole body was
 * `redirect('/welcome/roster')`. Under `cacheComponents`, that page renders
 * inside the layout's <Suspense>, so Next answers **200 with a prerendered
 * shell** and delivers the redirect as the last bytes of the streamed body.
 * Measured on preview for a signed-in admin, 2026-08-05:
 *
 *     status=200  x-nextjs-prerender=1  20655 bytes  4198ms
 *     body ends: $RX("B:1","NEXT_REDIRECT;replace;/welcome/roster;307;")
 *
 * Cut the stream in those 4.2 seconds and the browser holds a 200, half a
 * shell, and no instruction to go anywhere - so it shows its own error page.
 * Three people hit it on three platforms in two days, and a reload always
 * "fixed" it, which is why it read as flaky infrastructure rather than a bug.
 *
 * It lives OUTSIDE e2e/setu/ and has its own Playwright project with NO
 * `dependencies: ['setup']`. Under the `setu` project it would have inherited
 * the Admin-SDK session mint, and a credentials or env drift there would have
 * made this guardrail silently not run at all - the failure mode where the
 * suite goes green because the test never executed.
 *
 * WHY THIS TEST IS UNAUTHENTICATED, deliberately: a config redirect runs at
 * routing step 2, BEFORE middleware. So it must answer with a 3xx even to a
 * caller with no session - and if someone ever moves one of these back into a
 * page, the page would sit behind the auth gate and this assertion would see
 * middleware's redirect to /sign-in instead. Either regression fails here.
 *
 * It asserts the STATUS, not just the destination. A streamed redirect reaches
 * the right place too - in a browser, when the stream survives - so following
 * redirects and checking the final URL is exactly the test that would have
 * passed all through this bug.
 */

const REDIRECTS: ReadonlyArray<{ from: string; to: string }> = [
  { from: '/welcome', to: '/welcome/roster' },
  { from: '/admin/welcome', to: '/welcome/roster' },
  { from: '/family/enroll', to: '/family/enroll/bala-vihar' },
  { from: '/family/donations', to: '/family' },
  { from: '/admin/welcome-team', to: '/admin/users' },
  { from: '/admin/donation-periods', to: '/admin/programs' },
  { from: '/check-in/admin/reports', to: '/welcome/reports' },
  { from: '/check-in/teacher/attendance', to: '/check-in/teacher' },
  // The one genuinely permanent move, and the only 308 in the set.
  { from: '/disclaimers', to: '/acknowledgements' },
  // Parameterized. The levelId is arbitrary - nothing is read, the mapping is
  // pure path rewriting, which is the point.
  { from: '/teacher/levels/e2e-any-level/previous', to: '/teacher/levels/e2e-any-level/attendance' },
];

test.describe('path redirects are real HTTP redirects, never streamed', () => {
  for (const { from, to } of REDIRECTS) {
    test(`${from} answers 3xx -> ${to} with no body to truncate`, async () => {
      const ctx = await apiRequest.newContext({ baseURL: E2E_BASE_URL });
      try {
        const res = await ctx.get(from, { maxRedirects: 0, failOnStatusCode: false });

        expect(
          res.status(),
          `${from} answered ${res.status()}, not a redirect. If this is 200, the path is being ` +
            `RENDERED - the redirect is now streaming inside the body and can be cut off ` +
            `mid-flight, which is task #114. Put it back in next.config's redirects().`,
        ).toBeGreaterThanOrEqual(300);
        expect(res.status()).toBeLessThan(400);

        expect(res.headers()['location'], `${from} sent no Location header`).toBe(to);

        // A real redirect carries nothing that a dropped connection could
        // truncate. This is the property the whole fix is about.
        expect((await res.body()).length, `${from} returned a body with its redirect`).toBeLessThan(1024);
      } finally {
        await ctx.dispose();
      }
    });
  }

  test('a parameterized redirect carries the query string through', async () => {
    // The page this replaced re-appended `?date` by hand. Next does it for
    // free - but "for free" is worth an assertion, because losing it would
    // silently drop a teacher onto today's class instead of the date they
    // bookmarked, and nothing else would complain.
    const ctx = await apiRequest.newContext({ baseURL: E2E_BASE_URL });
    try {
      const res = await ctx.get('/teacher/levels/e2e-any-level/previous?date=2026-05-17', {
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      expect(res.status()).toBeGreaterThanOrEqual(300);
      expect(res.headers()['location']).toBe('/teacher/levels/e2e-any-level/attendance?date=2026-05-17');
    } finally {
      await ctx.dispose();
    }
  });
});
