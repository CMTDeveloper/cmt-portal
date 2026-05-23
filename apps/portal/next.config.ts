import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // cacheComponents + cacheLife are top-level since Next.js 16.1.
  cacheComponents: true,
  cacheLife: {
    family: {
      stale: 60,
      revalidate: 60,
      expire: 3600,
    },
    welcomeSearch: {
      stale: 30,
      revalidate: 30,
      expire: 600,
    },
  },
  experimental: {
    typedRoutes: true,
  },
  // Workspace packages must be transpiled because they ship .ts source
  transpilePackages: ['@cmt/ui', '@cmt/shared-domain', '@cmt/firebase-shared'],
};

export default config;
