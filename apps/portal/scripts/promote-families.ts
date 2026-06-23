/**
 * School-year rollover — STEP 2: promote families (UAT, idempotent).
 *
 * CLI parity for the rollover admin flow. Discovers every family with an ACTIVE
 * source-year Bala Vihar enrollment and advances each child to the next level
 * (graduating out, holding shishu, or flagging needs-attention) via the shared
 * `promoteFamilies()` engine. Idempotent: families already promoted to the
 * target year are skipped; needs-attention families keep their source
 * enrollment ACTIVE so a re-run picks them up once their grade is fixed.
 *
 * Standing constraints (mirrors backfill-bv-enrollments.ts):
 *   - UAT writes ONLY. Refuses unless PORTAL_FIREBASE_PROJECT_ID is
 *     chinmaya-setu-uat (pass --allow-prod to bypass — never used in normal ops).
 *   - `--dry-run` computes the same report without writing.
 *
 * Usage:
 *   pnpm --filter @cmt/portal school-year:promote [--from 2025-26] [--to 2026-27] [--dry-run] [--limit N] [--fid X] [--allow-prod]
 *
 *   # dry-run a sample (writes nothing)
 *   pnpm --filter @cmt/portal school-year:promote --dry-run --limit 20
 */

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { promoteFamilies } from '@/features/setu/rollover/promote-families';

const ACTOR_MID = 'script:promote-families';

interface Args {
  fromYear: string | null;
  toYear: string | null;
  dryRun: boolean;
  limit: number | null;
  fid: string | null;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    fromYear: null,
    toYear: null,
    dryRun: false,
    limit: null,
    fid: null,
    allowProd: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--allow-prod') args.allowProd = true;
    else if (a === '--from') args.fromYear = argv[++i] ?? args.fromYear;
    else if (a === '--to') args.toYear = argv[++i] ?? args.toYear;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--fid') args.fid = argv[++i] ?? null;
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

  console.log('\nSchool-year rollover — promote families');
  console.log(`  Write to:   ${portalProject} (Firestore${args.dryRun ? ', DRY-RUN — no writes' : ''})`);
  console.log(`  From year:  ${args.fromYear ?? '(app current year)'}`);
  console.log(`  To year:    ${args.toYear ?? '(derived next year)'}`);
  if (args.limit !== null) console.log(`  Limit:      first ${args.limit} families`);
  if (args.fid !== null) console.log(`  Filter:     fid=${args.fid} only`);
  console.log('');

  const report = await promoteFamilies(portalFirestore(), {
    ...(args.fromYear ? { fromYear: args.fromYear } : {}),
    ...(args.toYear ? { toYear: args.toYear } : {}),
    actorMid: ACTOR_MID,
    dryRun: args.dryRun,
    ...(args.limit != null ? { limit: args.limit } : {}),
    ...(args.fid ? { fidFilter: args.fid } : {}),
  });

  console.log('Summary:');
  console.log(`  Years:                  ${report.fromYear} → ${report.toYear}${report.dryRun ? ' (DRY-RUN — no writes)' : ''}`);
  console.log(`  Families processed:     ${report.familiesProcessed}`);
  console.log(`  Skipped (already done): ${report.familiesSkippedAlreadyPromoted}`);
  console.log(`  Promoted (children):    ${report.promoted}`);
  console.log(`  Advanced:               ${report.advanced}`);
  console.log(`  Shishu stayed:          ${report.shishuStayed}`);
  console.log(`  Graduated:              ${report.graduated}`);
  console.log(`  Needs attention:        ${report.needsAttention}`);

  console.log('  By transition:');
  if (report.byTransition.length === 0) {
    console.log('    (none)');
  } else {
    for (const t of report.byTransition) {
      console.log(`    ${t.label}: ${t.count}`);
    }
  }

  console.log('  Needs attention (fix grade then re-run):');
  if (report.attention.length === 0) {
    console.log('    (none)');
  } else {
    for (const row of report.attention) {
      console.log(`    ${row.childName.padEnd(24)} ${row.outcomeKind.padEnd(16)} fid=${row.fid}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
