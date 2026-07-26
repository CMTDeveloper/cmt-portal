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
 *     [--dry-run] [--limit N] [--fid X] [--csv-out path] [--allow-prod] \
 *     [--include-dormant]
 *
 * Defaults: writes against UAT (PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat).
 * Refuses to write to prod unless --allow-prod is passed.
 *
 * DORMANT FAMILIES ARE SKIPPED BY DEFAULT (spec 1.9b) - a family with no centre
 * and no level on any roster row. Measured on the 2026-06-10 snapshot: 299 of
 * 867. They are not lost; lazyMigrateLegacyFamily still runs on their first
 * sign-in, kiosk check-in, or teacher add. Pass --include-dormant to migrate
 * them anyway (you almost certainly do not want this - it is the switch that
 * puts ~190 stale-grade children back into teachers' class lists).
 *
 * IMPORTANT: refresh the RTDB snapshot immediately before a production run.
 * readRtdb() serves from .rtdb-snapshot whenever RTDB_SNAPSHOT_DIR is set (it is,
 * per CLAUDE.md) and never touches the network, so a stale snapshot would
 * silently migrate stale data with no error:
 *   pnpm --filter @cmt/portal snapshot:rtdb
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
import { listDormantLegacyFids } from '@/features/setu/registration/legacy-parser';
import { lazyMigrateLegacyFamily } from '@/features/setu/registration/lazy-migrate';

interface Args {
  dryRun: boolean;
  limit: number | null;
  fid: string | null;
  csvOut: string | null;
  allowProd: boolean;
  includeDormant: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: false, limit: null, fid: null, csvOut: null, allowProd: false, includeDormant: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--allow-prod') args.allowProd = true;
    else if (a === '--include-dormant') args.includeDormant = true;
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
  status: 'migrated' | 'skipped' | 'error' | 'dry-run' | 'dormant';
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

  // Dormant families - no centre AND no level on any roster row - are skipped by
  // default. Their children's grades are years stale, and migrating them would
  // put ~190 of them into Brampton teachers' "Registered - not enrolled" lists
  // on launch Sunday at levels they will never attend. Nothing is lost: they
  // still enter Setu via lazyMigrateLegacyFamily the moment they sign in, check
  // in at the kiosk, or are added by a teacher - at which point they are asked
  // for their real centre and the parent re-confirms the grade.
  //
  // `--fid X` is an explicit, single-family instruction (the debugging path), so
  // it overrides the skip. Otherwise asking for a dormant family by id would
  // report "0 matched" and look like the family does not exist, when in fact it
  // was filtered a step earlier.
  const skipDormant = !args.includeDormant && args.fid === null;
  const dormantFids = skipDormant ? await listDormantLegacyFids() : new Set<string>();
  const dormantRows: Row[] = [];
  if (!skipDormant) {
    console.log(
      args.includeDormant
        ? `  → --include-dormant: dormant families will NOT be skipped`
        : `  → --fid given: the dormant skip is bypassed for this single family`,
    );
  }
  if (skipDormant) {
    const before = families.length;
    const skipped = families.filter((f) => dormantFids.has(String(f.fid)));
    families = families.filter((f) => !dormantFids.has(String(f.fid)));
    for (const f of skipped) {
      dormantRows.push({
        legacyFid: String(f.fid),
        legacyName: f.name,
        members: (f.students?.length ?? 0) + (f.contacts?.length ?? 0),
        newFid: '',
        status: 'dormant',
      });
    }
    console.log(`  → ${skipped.length} dormant families skipped (no centre and no level on any row)`);
    console.log(`  → ${families.length} to migrate (of ${before})`);
  }

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
    console.log(`  Dry-run:   ${counts.dryRun} families would be migrated`);
  } else {
    console.log(`  Migrated:  ${counts.migrated}`);
    console.log(`  Skipped:   ${counts.skipped} (already migrated)`);
    console.log(`  Errors:    ${counts.error}`);
  }
  console.log(`  Dormant:   ${dormantRows.length} (skipped on purpose - they migrate lazily on first sign-in)`);
  console.log(`  Total:     ${rows.length + dormantRows.length} legacy families examined`);

  if (args.csvOut) {
    const header = 'legacyFid,legacyName,memberRows,newFid,status,error\n';
    // Dormant skips go in the CSV too, so the skipped set is auditable rather
    // than a number nobody can check.
    const body = [...rows, ...dormantRows].map(fmtRow).join('\n');
    writeFileSync(args.csvOut, header + body + '\n', 'utf-8');
    console.log(`\nCSV report written to ${args.csvOut}`);
  }

  process.exit(counts.error > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
