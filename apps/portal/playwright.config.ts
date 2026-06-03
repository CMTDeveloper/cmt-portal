import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Playwright's TEST RUNNER does not auto-load .env.local (only the Next dev
// webServer does, via Next's own loader). auth.setup reads E2E_FAMILY_EMAIL /
// E2E_FAMILY_PASSWORD from process.env, so load .env.local here too. Existing
// env wins. Dependency-free parser — neither dotenv nor @next/env is hoisted as
// a direct dep under pnpm. Absent file (CI without creds) → specs self-skip.
function loadEnvLocal(): void {
  try {
    const file = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const raw of file.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!key || key in process.env) continue;
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch {
    // .env.local absent — fine; specs self-skip when creds are missing.
  }
}
loadEnvLocal();

const STORAGE = 'e2e/.auth/family.json';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'setu',
      testMatch: /e2e\/setu\/.*\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE },
    },
    {
      name: 'unauthenticated',
      testMatch: /e2e\/unauth\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    { name: 'legacy', testMatch: /e2e\/legacy\/.*\.spec\.ts$/, use: { ...devices['Desktop Chrome'] } },
  ],
  // Skip the local dev server when targeting a deployed URL (PLAYWRIGHT_BASE_URL),
  // e.g. PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm test:e2e.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // dev:e2e = `next dev --port=3001`. A dedicated script avoids the
        // `pnpm … dev -- --port` indirection, which pnpm mis-parses as a directory.
        command: 'pnpm --filter @cmt/portal dev:e2e',
        url: 'http://localhost:3001',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },
});
