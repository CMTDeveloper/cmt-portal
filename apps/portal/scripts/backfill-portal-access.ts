/**
 * Backfill members.portalAccess='pending' on gated (non-manager) members.
 *
 * Iterates the UAT `members` collectionGroup. For each member whose mid is NOT
 * in its family's `managers` array AND which lacks `portalAccess`, sets
 * `portalAccess:'pending'`. Managers and members that already have a
 * portalAccess value are left untouched (absent ⇒ active; the gate only
 * applies to non-manager roster-origin members). Idempotent — re-runs skip
 * members that already carry a portalAccess value.
 *
 * Children technically have no contactKey / sign-in path, but the gate keys off
 * manager-membership (not type), so any non-manager member without portalAccess
 * is marked pending; this is harmless for children (they never sign in) and
 * keeps the rule a single, auditable condition.
 *
 * Usage:
 *   pnpm --filter @cmt/portal backfill:portal-access [--dry-run] [--limit N] [--fid CMT-X]
 *
 * Defaults to UAT (PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat). REFUSES to
 * write unless the target is UAT; pass --allow-prod to bypass (never do this
 * against prod 715b8).
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

interface Args {
  dryRun: boolean;
  limit: number | null;
  fid: string | null;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, limit: null, fid: null, allowProd: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--dry-run') a.dryRun = true;
    else if (v === '--allow-prod') a.allowProd = true;
    else if (v === '--limit') a.limit = Number(argv[++i]);
    else if (v === '--fid') a.fid = argv[++i] ?? null;
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const project = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  if (project !== 'chinmaya-setu-uat' && !args.allowProd) {
    console.error(
      `REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${project}", expected "chinmaya-setu-uat". Pass --allow-prod to bypass (never against prod 715b8).`,
    );
    process.exit(1);
  }

  console.log(`\nBackfill portalAccess='pending' on gated (non-manager) members`);
  console.log(`  Target:   ${project} (Firestore${args.dryRun ? ', DRY-RUN — no writes' : ''})`);
  if (args.limit !== null) console.log(`  Limit:    first ${args.limit} eligible members`);
  if (args.fid !== null) console.log(`  Filter:   fid=${args.fid} only`);
  console.log('');

  const db = portalFirestore();

  // Cache family.managers per fid so we read each family doc at most once.
  const managersByFid = new Map<string, string[]>();
  async function managersFor(fid: string): Promise<string[]> {
    const cached = managersByFid.get(fid);
    if (cached) return cached;
    const snap = await db.collection('families').doc(fid).get();
    const data = snap.data() as { managers?: string[] } | undefined;
    const managers = Array.isArray(data?.managers) ? data.managers : [];
    managersByFid.set(fid, managers);
    return managers;
  }

  const membersSnap = await db.collectionGroup('members').get();
  console.log(`Scanning ${membersSnap.size} member docs…\n`);

  let processed = 0;
  let updated = 0;
  let skippedManager = 0;
  let skippedHasAccess = 0;

  for (const doc of membersSnap.docs) {
    const m = doc.data() as {
      mid?: string;
      manager?: boolean;
      portalAccess?: 'active' | 'pending';
    };
    const fid = doc.ref.parent.parent?.id ?? '';
    if (args.fid && fid !== args.fid) continue;
    if (args.limit !== null && processed >= args.limit) break;
    processed++;

    // Already has an explicit access value — idempotent skip.
    if (m.portalAccess !== undefined) {
      skippedHasAccess++;
      continue;
    }

    const mid = m.mid ?? doc.id;
    const managers = await managersFor(fid);
    const isManager = m.manager === true || managers.includes(mid);
    if (isManager) {
      skippedManager++;
      continue;
    }

    if (args.dryRun) {
      console.log(`  would set pending: ${fid}/${mid}`);
    } else {
      await doc.ref.set({ portalAccess: 'pending' }, { merge: true });
    }
    updated++;
  }

  console.log(`\nSummary:`);
  console.log(`  Processed:        ${processed}`);
  console.log(`  Set to pending:   ${updated}${args.dryRun ? ' (dry-run, not written)' : ''}`);
  console.log(`  Skipped manager:  ${skippedManager}`);
  console.log(`  Skipped (has access): ${skippedHasAccess}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
