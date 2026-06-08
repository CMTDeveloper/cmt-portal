import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Two projects so node-only tests don't pay jsdom's (expensive) per-file
// environment setup. ~75% of portal test files are node-only `.test.ts` (API
// routes, schemas, engines, pure logic); only `.test.tsx` component tests need
// a DOM. Loading jsdom for everything is what thrashed under parallel load and
// blew the default 5s testTimeout on the full pre-push run. Splitting the
// environment + a 15s timeout makes the suite faster AND removes the flakiness.
const alias = {
  '@': path.resolve(__dirname, './src'),
  'server-only': path.resolve(__dirname, './src/__mocks__/server-only.ts'),
};

const exclude = ['**/node_modules/**', '**/dist/**', 'e2e/**', 'src/__tests__/e2e/**'];

const TIMEOUT = 15_000;

export default defineConfig({
  test: {
    projects: [
      {
        // React component tests — need a DOM + jest-dom matchers.
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./vitest.setup.ts'],
          include: ['**/*.test.tsx'],
          exclude,
          testTimeout: TIMEOUT,
          hookTimeout: TIMEOUT,
        },
      },
      {
        // Everything else — runs in the much-lighter node environment.
        // react() kept for the rare `.test.ts` that transitively imports a .tsx
        // module (transform only; no DOM is used).
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          globals: true,
          include: ['**/*.test.ts'],
          exclude,
          testTimeout: TIMEOUT,
          hookTimeout: TIMEOUT,
        },
      },
    ],
  },
});
