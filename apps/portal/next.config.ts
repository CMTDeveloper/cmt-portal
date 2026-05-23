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
};

export default config;
