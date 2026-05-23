import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env.local before any test modules are evaluated.
// This ensures PORTAL_FIREBASE_* vars are in process.env when the
// hasUatCreds guard const is read at module parse time.
try {
  const envPath = resolve(process.cwd(), '.env.local');
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const raw = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes if present
    const val = raw.replace(/^["']|["']$/g, '');
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
} catch {
  // .env.local is optional — tests will self-skip when creds are missing
}
