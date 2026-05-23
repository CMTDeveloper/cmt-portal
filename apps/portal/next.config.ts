import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // cacheComponents intentionally OFF for now. The codebase has too many
  // legacy patterns (new Date() in Server Components, blocking data fetches
  // outside <Suspense>, force-dynamic exports that pre-dated 16.1) to migrate
  // safely in a single pass. The supporting infrastructure is already in
  // place — getFamilyByFid extracted, layouts use Suspense, mutation routes
  // call revalidateTag — so a future incremental opt-in will be cheap.
  // Re-enable once the /check-in/* pages + dashboard new Date() usage are
  // migrated to Client Components or wrapped in <Suspense> / Cache Components.
  experimental: {
    typedRoutes: true,
  },
  // Workspace packages must be transpiled because they ship .ts source
  transpilePackages: ['@cmt/ui', '@cmt/shared-domain', '@cmt/firebase-shared'],
};

export default config;
