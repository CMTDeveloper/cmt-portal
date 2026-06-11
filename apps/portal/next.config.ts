import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
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
};

export default config;
