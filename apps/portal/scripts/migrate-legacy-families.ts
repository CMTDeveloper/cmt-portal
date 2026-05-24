/**
 * Slice 2f — Bulk legacy family migration.
 *
 * Reads every family from the prod RTDB roster (MASTER_FIREBASE credentials)
 * and pre-populates the Setu Firestore (PORTAL_FIREBASE credentials) by
 * calling lazyMigrateLegacyFamily(legacyFid) per family. Idempotent — re-runs
 * skip already-migrated families.
 *
 * Usage:
 *   pnpm --filter @cmt/portal exec tsx scripts/migrate-legacy-families.ts \
 *     [--dry-run] [--limit N] [--fid X] [--csv-out path] [--allow-prod]
 *
 * Defaults: writes against UAT (PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat).
 * Refuses to write to prod unless --allow-prod is passed.
 *
 * Examples:
 *   # dry-run, show plan for all families
 *   pnpm exec tsx scripts/migrate-legacy-families.ts --dry-run
 *
 *   # migrate first 5 families to UAT, write CSV report
 *   pnpm exec tsx scripts/migrate-legacy-families.ts --limit 5 --csv-out /tmp/mig.csv
 *
 *   # migrate just one family by legacyFid for debugging
 *   pnpm exec tsx scripts/migrate-legacy-families.ts --fid 1257
 */

import { writeFileSync } from 'node:fs';
import { listAllFamilies } from '@/features/check-in/shared/rtdb/family-lookup';
import { lazyMigrateLegacyFamily } from '@/features/setu/registration/lazy-migrate';

interface Args {
  dryRun: boolean;
  limit: number | null;
  fid: string | null;
  csvOut: string | null;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, limit: null, fid: null, csvOut: null, allowProd: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--allow-prod') args.allowProd = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--fid') args.fid = argv[++i] ?? null;
    else if (a === '--csv-out') args.csvOut = argv[++i] ?? null;
  }
  return args;
}

interface Row {
  legacyFid: string;
  legacyName: string;
  members: number;
  newFid: string | '';
  status: 'migrated' | 'skipped' | 'error' | 'dry-run';
  error?: string;
}

function fmtRow(r: Row): string {
  return [r.legacyFid, r.legacyName, r.members, r.newFid, r.status, r.error ?? '']
    .map((v) => String(v).replace(/[",\n]/g, ' '))
    .map((v) => `"${v}"`)
    .join(',');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const portalProject = process.env.PORTAL_FIREBASE_PROJECT_ID;
  const masterProject = process.env.MASTER_FIREBASE_PROJECT_ID;
  if (!portalProject || !masterProject) {
    console.error('REFUSED: PORTAL_FIREBASE_PROJECT_ID and MASTER_FIREBASE_PROJECT_ID must be set in .env.local');
    process.exit(1);
  }
  if (portalProject !== 'chinmaya-setu-uat' && !args.allowProd) {
    console.error(`REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${portalProject}", expected "chinmaya-setu-uat". Pass --allow-prod to bypass.`);
    process.exit(1);
  }

  console.log(`\nBulk legacy family migration`);
  console.log(`  Read from:  ${masterProject} (RTDB roster, read-only)`);
  console.log(`  Write to:   ${portalProject} (Firestore${args.dryRun ? ', DRY-RUN — no writes' : ''})`);
  if (args.limit !== null) console.log(`  Limit:      first ${args.limit} families`);
  if (args.fid !== null)   console.log(`  Filter:     legacyFid=${args.fid} only`);
  if (args.csvOut)         console.log(`  CSV out:    ${args.csvOut}`);
  console.log('');

  console.log('Reading legacy roster…');
  let families = await listAllFamilies();
  console.log(`  → ${families.length} legacy families found`);

  if (args.fid !== null) {
    families = families.filter((f) => String(f.fid) === args.fid);
    console.log(`  → ${families.length} matched --fid=${args.fid}`);
  }
  if (args.limit !== null) {
    families = families.slice(0, args.limit);
    console.log(`  → ${families.length} after --limit=${args.limit}`);
  }

  console.log('');
  const rows: Row[] = [];
  const counts = { migrated: 0, skipped: 0, error: 0, dryRun: 0 };

  for (let i = 0; i < families.length; i++) {
    const fam = families[i];
    if (!fam) continue;
    const legacyFid = String(fam.fid);
    const members = (fam.students?.length ?? 0) + (fam.contacts?.length ?? 0);
    const pos = `[${String(i + 1).padStart(3)}/${families.length}]`;

    if (args.dryRun) {
      const row: Row = { legacyFid, legacyName: fam.name, members, newFid: '', status: 'dry-run' };
      rows.push(row);
      counts.dryRun++;
      console.log(`${pos} ${legacyFid.padEnd(8)} "${fam.name}" — would migrate (${members} member-rows)`);
      continue;
    }

    try {
      const result = await lazyMigrateLegacyFamily(legacyFid);
      const row: Row = {
        legacyFid,
        legacyName: fam.name,
        members,
        newFid: result.fid,
        status: result.migrated ? 'migrated' : 'skipped',
      };
      rows.push(row);
      if (result.migrated) counts.migrated++;
      else counts.skipped++;
      console.log(`${pos} ${legacyFid.padEnd(8)} → ${result.fid}  ${result.migrated ? '✓ migrated' : '↺ skipped (exists)'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const row: Row = { legacyFid, legacyName: fam.name, members, newFid: '', status: 'error', error: msg };
      rows.push(row);
      counts.error++;
      console.error(`${pos} ${legacyFid.padEnd(8)} ✗ ERROR: ${msg}`);
    }
  }

  console.log(`\nSummary:`);
  if (args.dryRun) {
    console.log(`  Dry-run: ${counts.dryRun} families would be migrated`);
  } else {
    console.log(`  Migrated:  ${counts.migrated}`);
    console.log(`  Skipped:   ${counts.skipped} (already migrated)`);
    console.log(`  Errors:    ${counts.error}`);
    console.log(`  Total:     ${rows.length}`);
  }

  if (args.csvOut) {
    const header = 'legacyFid,legacyName,memberRows,newFid,status,error\n';
    const body = rows.map(fmtRow).join('\n');
    writeFileSync(args.csvOut, header + body + '\n', 'utf-8');
    console.log(`\nCSV report written to ${args.csvOut}`);
  }

  process.exit(counts.error > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
