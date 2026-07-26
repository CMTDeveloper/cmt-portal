/**
 * P2 Task 2 - backfill `sessionDate` onto existing `guest_check_ins` docs.
 *
 * The portal's guest check-in writer stamped only `date` (the actual Toronto
 * calendar day). Every teacher surface defaults its ?date= to the week's Sunday
 * via mostRecentSunday(), so a guest who walked in midweek was invisible to
 * teachers. The writer now dual-writes `date` + `sessionDate`; this backfills
 * `sessionDate` onto the docs written before that change.
 *
 * `date` is never modified. It is the only record of the day the guest actually
 * walked in, and `sessionDate` erases that.
 *
 * Usage:
 *   pnpm --filter @cmt/portal backfill:guest-session-date -- [--dry-run]
 *     [--limit N] [--recompute] [--allow-prod]
 *
 * Flags:
 *   --dry-run    print the mapping, write nothing. Run this FIRST, every time.
 *   --limit N    stop after N docs (a bounded first pass).
 *   --recompute  overwrite an existing `sessionDate`. Without it, docs that
 *                already have one are skipped (idempotent re-runs). This flag
 *                is the recovery path: the script writes real data once, and a
 *                bad run with only skip-if-present idempotence is unrecoverable.
 *   --allow-prod required unless PORTAL_FIREBASE_PROJECT_ID is the UAT project.
 *
 * Examples:
 *   pnpm --filter @cmt/portal backfill:guest-session-date -- --dry-run
 *   pnpm --filter @cmt/portal backfill:guest-session-date -- --limit 20
 *   pnpm --filter @cmt/portal backfill:guest-session-date -- --recompute
 */

import { sessionDateFor } from '@cmt/shared-domain';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

interface Args {
  dryRun: boolean;
  limit: number | null;
  recompute: boolean;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, limit: null, recompute: false, allowProd: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // `pnpm run <alias> -- --dry-run` forwards the bare `--` to the script.
    if (a === '--') continue;
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--recompute') args.recompute = true;
    else if (a === '--allow-prod') args.allowProd = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else {
      console.error(`REFUSED: unrecognized argument "${a}". See the header for usage.`);
      process.exit(1);
    }
  }
  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit <= 0)) {
    console.error('REFUSED: --limit must be a positive number.');
    process.exit(1);
  }
  return args;
}

const BATCH_SIZE = 400; // Firestore caps a WriteBatch at 500.

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const portalProject = process.env.PORTAL_FIREBASE_PROJECT_ID;
  if (!portalProject) {
    console.error('REFUSED: PORTAL_FIREBASE_PROJECT_ID must be set in .env.local');
    process.exit(1);
  }
  if (portalProject !== 'chinmaya-setu-uat' && !args.allowProd) {
    console.error(
      `REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${portalProject}", expected "chinmaya-setu-uat". ` +
        'Pass --allow-prod to bypass.',
    );
    process.exit(1);
  }

  console.log(
    `[backfill] project=${portalProject} dryRun=${args.dryRun} recompute=${args.recompute} ` +
      `limit=${args.limit ?? 'none'}`,
  );

  const db = portalFirestore();
  const snap = await db.collection('guest_check_ins').get();
  console.log(`[backfill] ${snap.size} guest_check_ins docs`);

  let written = 0;
  let skippedHasSessionDate = 0;
  let skippedNoDate = 0;
  let unchanged = 0;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    if (args.limit !== null && written >= args.limit) break;

    const data = doc.data() as { date?: unknown; sessionDate?: unknown };

    if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      // No usable calendar day: nothing to derive a Sunday from. Report it
      // rather than guessing - a wrong sessionDate is worse than none.
      console.warn(`[backfill] SKIP ${doc.id}: date is not a YYYY-MM-DD (${String(data.date)})`);
      skippedNoDate++;
      continue;
    }

    const existing = typeof data.sessionDate === 'string' ? data.sessionDate : null;
    if (existing !== null && !args.recompute) {
      skippedHasSessionDate++;
      continue;
    }

    const sessionDate = sessionDateFor(data.date);
    if (existing === sessionDate) {
      unchanged++;
      continue;
    }

    console.log(
      `[backfill] ${doc.id}: date=${data.date} -> sessionDate=${sessionDate}` +
        (existing !== null ? ` (was ${existing})` : ''),
    );

    if (!args.dryRun) {
      batch.update(doc.ref, { sessionDate });
      pending++;
      if (pending >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    written++;
  }

  if (!args.dryRun && pending > 0) await batch.commit();

  console.log(
    `[backfill] done. ${args.dryRun ? 'would write' : 'wrote'}=${written} ` +
      `alreadyCorrect=${unchanged} skippedHasSessionDate=${skippedHasSessionDate} ` +
      `skippedNoDate=${skippedNoDate}`,
  );
  if (args.dryRun) {
    console.log('[backfill] DRY RUN - nothing was written. Spot-check that a Sunday maps to ITSELF.');
  }
}

main().catch((err) => {
  console.error('[backfill] failed:', err);
  process.exit(1);
});
