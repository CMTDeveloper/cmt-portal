/**
 * Capture a local snapshot of the legacy prod RTDB (read-only) so that every
 * other local script/test reads the snapshot instead of re-downloading the
 * database (RTDB bills $1/GB downloaded and the legacy layout forces full-node
 * reads).
 *
 * Writes apps/portal/.rtdb-snapshot/{roster,families,meta}.json. The directory
 * is GITIGNORED — the roster contains real family PII (names, emails, phones)
 * and must never enter git history. Each dev machine captures its own copy.
 *
 * After capturing, set in apps/portal/.env.local:
 *   RTDB_SNAPSHOT_DIR=.rtdb-snapshot
 * and every readRtdb() call (scripts, next dev/build, integration tests)
 * resolves locally with zero network reads. Remove the var (or re-run this
 * script) when you need fresh data.
 *
 * Run: pnpm --filter @cmt/portal snapshot:rtdb
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { masterRtdb } from '@cmt/firebase-shared/admin/rtdb';

const OUT_DIR = join(process.cwd(), '.rtdb-snapshot');
// Every top-level node readRtdb() touches anywhere in the portal. If a new
// `readRtdb('/x')` call site appears, add 'x' here — snapshot mode throws on
// missing files rather than silently downloading.
const NODES = ['roster', 'families', 'classes', 'students'] as const;

async function main(): Promise<void> {
  // This script is the ONE deliberate live read — never resolve from a snapshot.
  delete process.env.RTDB_SNAPSHOT_DIR;

  const masterProject = process.env['MASTER_FIREBASE_PROJECT_ID'];
  if (!masterProject) {
    console.error('REFUSED: MASTER_FIREBASE_PROJECT_ID must be set in .env.local');
    process.exit(1);
  }

  console.log(`\nRTDB snapshot — reading ${masterProject} (read-only, one full download)`);
  mkdirSync(OUT_DIR, { recursive: true });

  const db = masterRtdb();
  const counts: Record<string, number> = {};
  let totalBytes = 0;

  for (const node of NODES) {
    const snap = await db.ref(`/${node}`).once('value');
    const value = (snap.val() as Record<string, unknown> | null) ?? {};
    const json = JSON.stringify(value, null, 1);
    writeFileSync(join(OUT_DIR, `${node}.json`), json, 'utf-8');
    counts[node] = Object.keys(value).length;
    totalBytes += Buffer.byteLength(json);
    console.log(`  /${node}: ${counts[node]} keys → ${node}.json (${(Buffer.byteLength(json) / 1024).toFixed(0)} KB)`);
  }

  writeFileSync(
    join(OUT_DIR, 'meta.json'),
    JSON.stringify({ capturedAt: new Date().toISOString(), masterProject, counts }, null, 1),
    'utf-8',
  );

  console.log(`\nSnapshot written to ${OUT_DIR} (${(totalBytes / 1024 / 1024).toFixed(1)} MB total).`);
  console.log('Set RTDB_SNAPSHOT_DIR=.rtdb-snapshot in apps/portal/.env.local to serve all local reads from it.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
