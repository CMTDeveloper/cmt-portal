/**
 * School-year rollover — STEP 1: start the new year (UAT, idempotent).
 *
 * CLI parity for the rollover admin flow. Clones the Bala Vihar levels +
 * offerings (and the legacy donationPeriods mirror) from `--from` to `--to`
 * via the shared `startNewYear()` engine. Idempotent: existing target docs are
 * skipped and never overwritten (preserving admin-assigned teacherRefs).
 *
 * Standing constraints (mirrors backfill-bv-enrollments.ts):
 *   - UAT writes ONLY. Refuses unless PORTAL_FIREBASE_PROJECT_ID is
 *     chinmaya-setu-uat (pass --allow-prod to bypass — never used in normal ops).
 *   - `--dry-run` computes the same created/existing lists without writing.
 *
 * Usage:
 *   pnpm --filter @cmt/portal school-year:start [--from 2025-26] [--to 2026-27] [--dry-run] [--allow-prod]
 *
 *   # dry-run (writes nothing)
 *   pnpm --filter @cmt/portal school-year:start --dry-run
 */

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { startNewYear } from '@/features/setu/rollover/start-new-year';

const ACTOR_MID = 'script:start-new-year';

interface Args {
  fromYear: string | null;
  toYear: string | null;
  dryRun: boolean;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    fromYear: null,
    toYear: null,
    dryRun: false,
    allowProd: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--allow-prod') args.allowProd = true;
    else if (a === '--from') args.fromYear = argv[++i] ?? args.fromYear;
    else if (a === '--to') args.toYear = argv[++i] ?? args.toYear;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const portalProject = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  if (!portalProject) {
    console.error('REFUSED: PORTAL_FIREBASE_PROJECT_ID must be set in .env.local');
    process.exit(1);
  }
  if (portalProject !== 'chinmaya-setu-uat' && !args.allowProd) {
    console.error(
      `REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${portalProject}", expected "chinmaya-setu-uat". Pass --allow-prod to bypass.`,
    );
    process.exit(1);
  }

  console.log('\nSchool-year rollover — start new year');
  console.log(`  Write to:   ${portalProject} (Firestore${args.dryRun ? ', DRY-RUN — no writes' : ''})`);
  console.log(`  From year:  ${args.fromYear ?? '(app current year)'}`);
  console.log(`  To year:    ${args.toYear ?? '(derived next year)'}`);
  console.log('');

  const result = await startNewYear(portalFirestore(), {
    ...(args.fromYear ? { fromYear: args.fromYear } : {}),
    ...(args.toYear ? { toYear: args.toYear } : {}),
    actorMid: ACTOR_MID,
    dryRun: args.dryRun,
  });

  console.log('Summary:');
  console.log(`  Years:                ${result.fromYear} → ${result.toYear}${args.dryRun ? ' (DRY-RUN — no writes)' : ''}`);
  console.log(`  Offerings created:    ${result.offeringsCreated.length}`);
  for (const oid of result.offeringsCreated) console.log(`    + ${oid}`);
  console.log(`  Offerings existing:   ${result.offeringsExisting.length}`);
  for (const oid of result.offeringsExisting) console.log(`    = ${oid}`);
  console.log(`  Levels created:       ${result.levelsCreated.length}`);
  for (const lid of result.levelsCreated) console.log(`    + ${lid}`);
  console.log(`  Levels existing:      ${result.levelsExisting.length}`);
  for (const lid of result.levelsExisting) console.log(`    = ${lid}`);
  console.log(`  DonationPeriods made: ${result.donationPeriodsCreated.length}`);
  for (const dp of result.donationPeriodsCreated) console.log(`    + ${dp}`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
