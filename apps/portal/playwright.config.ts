import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { E2E_BASE_URL, LOCAL_BASE_URL } from './e2e/_helpers';

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

/**
 * ── WHERE THE E2E SUITE POINTS, AND WHY IT IS NOT PRODUCTION ────────────────
 *
 * DEFAULT TARGET: the `develop` branch's Vercel Preview alias.
 *
 * These specs are not read-only. They seed fixture families, enroll children,
 * start pledges, and mutate GLOBAL config (`app_config/disclaimers.version`,
 * `app_config/school_year`) - the disclaimers bump alone re-gates every family
 * in the database. Running that against production is fine only for as long as
 * production IS the UAT database. From the 2026-08-03 cutover it will be
 * `chinmaya-setu-715b8`, holding real families' records, and a suite pointed at
 * it out of habit would rewrite their data.
 *
 * So the default moved to Preview BEFORE the cutover rather than after, while
 * getting it wrong is still harmless. Preview stays on `chinmaya-setu-uat`
 * permanently (runbook §9.0), which is what makes it the correct home for this.
 *
 * ⚠️ Until the Aug 3 flip, Preview and Production still share one database, so
 * this changes WHICH BUILD is exercised, not which data. It is not yet a
 * sandbox.
 *
 * Override for a deliberate one-off:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3001   -> spins up the local dev server
 *   PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app -> production, on purpose
 */
// Assigned in Vercel to the `develop` BRANCH (not to the Production
// environment), so it follows every push to develop and cannot go stale.
// That distinction is the whole ballgame: added the default way - via
// `vercel domains add`, or via the dashboard without setting the branch - this
// hostname serves PRODUCTION, and a suite that seeds families and rewrites
// app_config would have run against it. Both happened on 2026-07-28 before the
// branch assignment stuck. If this ever needs re-checking, compare
// `vercel alias ls` source deployments; an HTTP 200 says the name resolves, not
// which build answered.
//
// Equivalent and always correct by construction:
//   https://cmt-setu-git-develop-chinmaya-mission-torontos-projects.vercel.app
// (defined in ./e2e/_helpers so the SPECS and this config cannot disagree)
const RESOLVED_BASE_URL = E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // ALWAYS single-worker, not just in CI. Every setu spec drives the SAME
  // seeded UAT family through the SAME shared storageState, and several specs
  // (dashboard-slice1, enrollment-state, the registration specs) reseed that
  // family mid-run. The seed calls `auth.updateUser(uid, { password })`, which
  // bumps the Firebase user's `tokensValidAfterTime` and kills the session
  // SERVER-side - so every concurrently-running spec loses its auth mid-flight,
  // no matter which storageState file it loaded from.
  //
  // That is not theoretical: `playwright test --project=setu dashboard` failed
  // 6 tests on 2026-07-25, three of them in admin/dashboard-ia.spec.ts, which
  // passes cleanly on its own. Parallel workers against one mutable fixture in
  // a real database cannot be made safe by anything short of serializing.
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: RESOLVED_BASE_URL,
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
  // Start the local dev server ONLY when the resolved target IS localhost.
  // Keyed on the RESOLVED url, not on "was PLAYWRIGHT_BASE_URL set": now that
  // the default is a deployed preview, the old check would have booted a local
  // server and then pointed every test at Preview anyway.
  //
  // Spread rather than `webServer: cond ? {...} : undefined` - the repo runs
  // `exactOptionalPropertyTypes`, under which an explicit `undefined` is not the
  // same as an absent key, and Playwright's own types reject it.
  ...(RESOLVED_BASE_URL === LOCAL_BASE_URL
    ? {
        webServer: {
          // dev:e2e = `next dev --port=3001`. A dedicated script avoids the
          // `pnpm … dev -- --port` indirection, which pnpm mis-parses as a directory.
          command: 'pnpm --filter @cmt/portal dev:e2e',
          url: LOCAL_BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120 * 1000,
        },
      }
    : {}),
});
