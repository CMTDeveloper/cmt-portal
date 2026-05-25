/**
 * One-shot: dump a few raw roster rows from prod RTDB so we can see the
 * actual field shape (gender, pfname, plname, etc.) before fixing the
 * migration mapper.
 *
 * Usage: pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/inspect-legacy-roster.ts [--fid 1257]
 */

import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';

async function main() {
  const argv = process.argv.slice(2);
  const fidIdx = argv.indexOf('--fid');
  const targetFid = fidIdx >= 0 ? argv[fidIdx + 1] : null;

  const roster = (await readRtdb<Record<string, Record<string, unknown>>>('/roster')) ?? {};
  const rows = Object.entries(roster);
  console.log(`Total roster rows: ${rows.length}`);
  if (rows.length === 0) return;

  const allKeys = new Set<string>();
  for (const [, row] of rows) for (const k of Object.keys(row)) allKeys.add(k);
  console.log(`\nAll field names seen in roster:`);
  console.log([...allKeys].sort().join(', '));

  if (targetFid) {
    console.log(`\n--- rows for fid=${targetFid} ---`);
    const matched = rows.filter(([, r]) => String(r['fid']) === targetFid);
    console.log(JSON.stringify(matched.slice(0, 10).map(([, r]) => r), null, 2));
    return;
  }

  const sampleFids = [...new Set(rows.map(([, r]) => String(r['fid'])).filter(Boolean))].slice(0, 3);
  for (const fid of sampleFids) {
    console.log(`\n--- sample rows for fid=${fid} ---`);
    const matched = rows.filter(([, r]) => String(r['fid']) === fid);
    console.log(JSON.stringify(matched.map(([, r]) => r), null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
