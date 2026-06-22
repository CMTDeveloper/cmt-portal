/**
 * Backfill members.portalAccess='pending' on already-migrated roster members.
 *
 * Families bulk-migrated BEFORE the gate shipped lack the portalAccess flag that
 * lazy-migrate now writes. This backfill brings them in line, gating exactly the
 * same members lazy-migrate gates: a NON-MANAGER ADULT of a MIGRATED family
 * (`families/{fid}.legacyFid` present). It deliberately does NOT touch:
 *   - registration-added members of NEW Setu families (no legacyFid) — their
 *     manager added them, so they keep portal access;
 *   - managers (or any member already in family.managers);
 *   - children (no contactKey / sign-in path);
 *   - any member that already carries a portalAccess value (idempotent).
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

  console.log(`\nBackfill portalAccess='pending' on migrated non-manager adults`);
  console.log(`  Target:   ${project} (Firestore${args.dryRun ? ', DRY-RUN — no writes' : ''})`);
  if (args.limit !== null) console.log(`  Limit:    first ${args.limit} eligible members`);
  if (args.fid !== null) console.log(`  Filter:   fid=${args.fid} only`);
  console.log('');

  const db = portalFirestore();

  // Cache family.managers + migrated-ness (legacyFid present) per fid so we read
  // each family doc at most once.
  const familyByFid = new Map<string, { managers: string[]; migrated: boolean }>();
  async function familyFor(fid: string): Promise<{ managers: string[]; migrated: boolean }> {
    const cached = familyByFid.get(fid);
    if (cached) return cached;
    const snap = await db.collection('families').doc(fid).get();
    const data = snap.data() as { managers?: string[]; legacyFid?: string | null } | undefined;
    const info = {
      managers: Array.isArray(data?.managers) ? data.managers : [],
      migrated: typeof data?.legacyFid === 'string' && data.legacyFid.length > 0,
    };
    familyByFid.set(fid, info);
    return info;
  }

  const membersSnap = await db.collectionGroup('members').get();
  console.log(`Scanning ${membersSnap.size} member docs…\n`);

  let processed = 0;
  let updated = 0;
  let skippedManager = 0;
  let skippedHasAccess = 0;
  let skippedNotMigrated = 0;
  let skippedChild = 0;

  for (const doc of membersSnap.docs) {
    const m = doc.data() as {
      mid?: string;
      manager?: boolean;
      type?: 'Adult' | 'Child';
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

    const family = await familyFor(fid);
    // Only MIGRATED families are gated (registration-added members keep access).
    if (!family.migrated) {
      skippedNotMigrated++;
      continue;
    }

    const mid = m.mid ?? doc.id;
    const isManager = m.manager === true || family.managers.includes(mid);
    if (isManager) {
      skippedManager++;
      continue;
    }

    // Only adults are gated — children have no contactKey / sign-in path. Mirrors
    // lazy-migrate, which sets pending only on non-primary adults.
    if (m.type !== 'Adult') {
      skippedChild++;
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
  console.log(`  Processed:            ${processed}`);
  console.log(`  Set to pending:       ${updated}${args.dryRun ? ' (dry-run, not written)' : ''}`);
  console.log(`  Skipped manager:      ${skippedManager}`);
  console.log(`  Skipped non-migrated: ${skippedNotMigrated}`);
  console.log(`  Skipped child:        ${skippedChild}`);
  console.log(`  Skipped (has access): ${skippedHasAccess}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
