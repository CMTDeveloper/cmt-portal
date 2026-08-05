import path from 'node:path';
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const config: NextConfig = {
  reactStrictMode: true,
  // @sentry/profiling-node ships a native v8 addon (.node). Keep it external so
  // Next.js requires it at runtime from node_modules instead of trying to
  // bundle the binary into the serverless function (which fails on Vercel).
  serverExternalPackages: ['@sentry/profiling-node'],
  // Next.js 16 Cache Components: explicit opt-in cache model. Any Server
  // Component data access is dynamic by default; wrap reads in 'use cache'
  // (with cacheLife + cacheTag) to make them cacheable. revalidateTag()
  // in mutation routes invalidates those tags. Dynamic content must live
  // inside <Suspense>, and request-time-only APIs (new Date(), Math.random())
  // require an awaited connection()/cookies()/headers() first.
  cacheComponents: true,
  typedRoutes: true,
  // Custom cacheLife profiles keyed by domain concept.
  cacheLife: {
    family: {
      stale: 60,        // client revalidate after 60s
      revalidate: 300,  // server revalidate after 5min
      expire: 3600,     // hard expire after 1h
    },
  },
  // Workspace packages must be transpiled because they ship .ts source
  transpilePackages: ['@cmt/ui', '@cmt/shared-domain', '@cmt/firebase-shared'],
  // /docs renders the repo-root markdown runbooks at request time. They live
  // outside apps/portal, so output tracing needs (a) the tracing root lifted
  // to the monorepo root — files outside it are never traced — and (b) the
  // runbooks force-included for the /docs routes (globs in both root-relative
  // and project-relative form; non-matching extras are harmless). Without
  // this, fs reads 404 every guide on Vercel while working fine locally.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  outputFileTracingIncludes: {
    '/docs': ['docs/runbooks/**/*.md', '../../docs/runbooks/**/*.md'],
    '/docs/*': ['docs/runbooks/**/*.md', '../../docs/runbooks/**/*.md'],
  },
  /**
   * ── EVERY path-to-path redirect belongs HERE, not in a page ────────────────
   *
   * These were `page.tsx` files whose whole body was `redirect('/somewhere')`.
   * That looks equivalent and is not. With `cacheComponents: true`, a page
   * renders inside the layout's <Suspense>, so Next sends **HTTP 200 plus a
   * prerendered shell first** and delivers the redirect as the LAST BYTES OF
   * THE STREAMED BODY. Measured on `/welcome` for a signed-in admin,
   * 2026-08-05:
   *
   *     status=200  x-nextjs-prerender=1  20655 bytes  4198ms
   *     body ends: $RX("B:1","NEXT_REDIRECT;replace;/welcome/roster;307;")
   *
   * Cut that stream anywhere in those 4.2 seconds - cold start, function
   * timeout, a phone changing network - and the browser is left holding a 200,
   * a partial shell, and no instruction to go anywhere. It shows its OWN error
   * page ("This page couldn't load"), which is why the report never looked like
   * a server error and why reloading always fixed it. Three people hit it on
   * three platforms between 2026-08-04 and 2026-08-05 (task #114); `/welcome`
   * is the first thing staff open each session, so it is the most likely of all
   * of them to meet a cold function.
   *
   * `redirects` here is step 2 of Next's routing order - BEFORE middleware and
   * long before any React renders - so the answer is a real 3xx with an empty
   * body. There is no stream to truncate.
   *
   * NINE pages had this shape. The first sweep found eight and said so; the
   * parameterized one under /teacher was missed because it was not a bare
   * `redirect('/literal')`. Every remaining `redirect()` in a page is
   * CONDITIONAL - an auth or state gate - and those must stay pages, so they
   * keep the streamed shape by necessity. If a "couldn't load" report ever
   * points at one of THOSE paths, this is the mechanism to suspect again.
   *
   * `permanent: false` (307) on purpose for the app's own paths: a 308 is
   * cached by the browser more or less forever, so getting a destination wrong
   * would strand staff on their own machines with no way for us to correct it.
   * The one genuinely permanent move (/disclaimers) keeps its 308.
   *
   * Query strings are preserved automatically. If a redirect ever needs to READ
   * something - a session, a role, a flag - it does not belong here; put it in
   * middleware, which is also a real redirect and also never streams.
   */
  async redirects() {
    return [
      // The family acknowledgements screen moved from /disclaimers to
      // /acknowledgements. Genuinely permanent, and the only 308 here.
      { source: '/disclaimers', destination: '/acknowledgements', permanent: true },

      // Section indexes: the segment has no page of its own, it opens on one.
      { source: '/welcome', destination: '/welcome/roster', permanent: false },
      { source: '/admin/welcome', destination: '/welcome/roster', permanent: false },
      { source: '/family/enroll', destination: '/family/enroll/bala-vihar', permanent: false },

      // Screens that were folded into another one.
      { source: '/family/donations', destination: '/family', permanent: false },
      { source: '/admin/welcome-team', destination: '/admin/users', permanent: false },
      { source: '/admin/donation-periods', destination: '/admin/programs', permanent: false },
      { source: '/check-in/admin/reports', destination: '/welcome/reports', permanent: false },
      { source: '/check-in/teacher/attendance', destination: '/check-in/teacher', permanent: false },

      // Parameterized, and the query string rides along automatically - which
      // is the whole reason this one had a page: it was re-appending ?date
      // by hand. It validated the date format first; the attendance screen
      // validates its own `date` param regardless, so passing one through
      // unchecked is no different from a teacher typing it there directly.
      {
        source: '/teacher/levels/:levelId/previous',
        destination: '/teacher/levels/:levelId/attendance',
        permanent: false,
      },
    ];
  },
  // Baseline browser-security headers on every response. HSTS is already added
  // by the Vercel platform. A full script-src/default-src CSP is intentionally
  // deferred — Next's inline bootstrap scripts need per-request nonces/hashes,
  // which is a dedicated change; this ships the high-value, no-risk headers now
  // (anti-clickjacking, MIME-sniffing, referrer leakage, feature access).
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default withSentryConfig(config, {
  // Org/project/token drive build-time source-map upload. They are read from
  // env (set SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN in Vercel). When
  // absent — e.g. local pre-push build — upload is skipped and the build still
  // succeeds. Conditional spreads keep this valid under exactOptionalPropertyTypes.
  silent: !process.env.CI,
  widenClientFileUpload: true,
  ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT ? { project: process.env.SENTRY_PROJECT } : {}),
  ...(process.env.SENTRY_AUTH_TOKEN
    ? { authToken: process.env.SENTRY_AUTH_TOKEN }
    : {}),
});
