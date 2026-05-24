import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/e2e/**/*.e2e.test.ts'],
    testTimeout: 60000,
    pool: 'forks',
    singleFork: true,
    // Run files sequentially. Without this, file A's afterAll cleanupTestData()
    // can wipe file B's _test:true docs mid-flight (cleanup is a global sweep,
    // not RUN_ID-scoped). Each file already runs <10s, total ~30s — fine.
    fileParallelism: false,
    // setupFiles runs in each worker before test files are imported.
    // This ensures PORTAL_FIREBASE_* vars from .env.local are in process.env
    // when the module-level hasUatCreds const is evaluated.
    setupFiles: ['./src/__tests__/e2e/setup.ts'],
    envFile: path.resolve(__dirname, '.env.local'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/__mocks__/server-only.ts'),
    },
  },
});
