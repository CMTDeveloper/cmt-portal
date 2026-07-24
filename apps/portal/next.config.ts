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
  // The family acknowledgements screen moved from /disclaimers to
  // /acknowledgements. Keep the old path working for any in-flight session or
  // stale link (the route is a server-redirect gate target, so inbound links
  // are near-zero, but the redirect is cheap insurance).
  async redirects() {
    return [{ source: '/disclaimers', destination: '/acknowledgements', permanent: true }];
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
