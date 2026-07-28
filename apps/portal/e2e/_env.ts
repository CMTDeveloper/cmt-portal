import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ── LOAD .env.local BEFORE ANY MODULE READS process.env ─────────────────────
 *
 * Playwright's TEST RUNNER does not auto-load `.env.local` (only the Next dev
 * webServer does, via Next's own loader), so the suite loads it itself.
 *
 * This lives in its own module, imported for its SIDE EFFECT, because ordering
 * is the whole point. It used to be a function defined inside
 * `playwright.config.ts` and called at line 31 - fine until the config also
 * grew an `import … from './e2e/_helpers'` at line 4. ES imports are hoisted:
 * `_helpers` evaluated first, read `process.env.E2E_FAMILY_EMAIL` into a
 * top-level const while the environment was still empty, and froze
 * `hasFamilyCreds` as `false`. Fourteen tests then self-skipped and the run
 * reported "5 passed" in green.
 *
 * That is the dangerous shape of this bug: a skip is not a failure. The suite
 * stays green while most of it quietly stops testing anything.
 *
 * Importing this module first makes the ordering explicit and independent of
 * who imports whom.
 *
 * Existing env wins, so an explicit `FOO=bar pnpm test:e2e` still overrides the
 * file. Dependency-free parser - neither dotenv nor @next/env is hoisted as a
 * direct dep under pnpm. Absent file (CI without creds) → specs self-skip.
 */
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
    // .env.local absent - fine; specs self-skip when creds are missing.
  }
}

loadEnvLocal();

export {};
