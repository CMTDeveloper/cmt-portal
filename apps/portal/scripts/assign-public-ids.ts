/**
 * Issue #4 — One-time public-id backfill.
 *
 * Assigns a 4-digit `publicFid` to every existing Setu family and a 5-digit
 * `publicMid` to every existing member, drawing from the SAME Task-3 counters
 * (`counters/familyPublicId`, `counters/memberPublicId`) that runtime creation
 * uses — so the backfill and live mint-at-creation can never collide.
 *
 * Families are processed oldest-first (`orderBy createdAt asc`) so the oldest
 * family deterministically gets the first id (1001), the next 1002, etc.
 *
 * Idempotent: a family/member that already carries its public id is skipped and
 * draws no counter value. Re-runs assign nothing.
 *
 * UAT by default. Refuses to write unless PORTAL_FIREBASE_PROJECT_ID is
 * `chinmaya-setu-uat`; pass --allow-prod to override.
 *
 * Usage:
 *   pnpm --filter @cmt/portal migrate:public-ids --dry-run --limit 5 --csv-out /tmp/public-ids.csv
 *   pnpm --filter @cmt/portal migrate:public-ids --fid CMT-XXXXXXXX
 *   pnpm --filter @cmt/portal migrate:public-ids
 */

import { writeFileSync } from 'node:fs';
import type { Firestore } from 'firebase-admin/firestore';

/** The two allocator functions, injected so the core stays unit-testable. */
export interface Allocators {
  allocateFamilyPublicId: () => Promise<string>;
  allocateMemberPublicIds: (count: number) => Promise<string[]>;
}

export interface AssignOpts {
  dryRun: boolean;
  limit: number | null;
  fid: string | null;
}

export interface MappingRow {
  kind: 'family' | 'member';
  /** Firestore doc id (CMT-prefixed fid, or member doc id). */
  oldId: string;
  /** Newly allocated public id. */
  newId: string;
  /** Owning family doc id (empty for family rows). */
  fid: string;
}

export interface AssignResult {
  rows: MappingRow[];
  familiesScanned: number;
  familiesAssigned: number;
  membersScanned: number;
  membersAssigned: number;
}

/**
 * Core backfill logic — pure aside from the injected `db` + `allocators`, so it
 * can be exercised against a fake Firestore in unit tests.
 *
 * Each public id is allocated OUTSIDE any caller transaction; the allocator owns
 * its own runTransaction, and these are simple `.update()` writes. Allocation
 * only happens for records that lack their public id, so re-runs neither write
 * nor advance the counters for already-stamped records.
 */
export async function assignPublicIds(
  db: Firestore,
  allocators: Allocators,
  opts: AssignOpts,
): Promise<AssignResult> {
  const { dryRun, limit, fid } = opts;
  const rows: MappingRow[] = [];
  let familiesScanned = 0;
  let familiesAssigned = 0;
  let membersScanned = 0;
  let membersAssigned = 0;

  let famQuery = db.collection('families').orderBy('createdAt', 'asc');
  if (fid) {
    // Single-family mode: restrict to the one doc (still ordered for determinism).
    famQuery = db
      .collection('families')
      .where('fid', '==', fid)
      .orderBy('createdAt', 'asc');
  }
  const familySnap = await famQuery.get();

  for (const famDoc of familySnap.docs) {
    if (limit !== null && familiesScanned >= limit) break;
    familiesScanned++;
    const data = famDoc.data() as { publicFid?: string };

    if (!data.publicFid) {
      const publicFid = await allocators.allocateFamilyPublicId();
      rows.push({ kind: 'family', oldId: famDoc.id, newId: publicFid, fid: '' });
      familiesAssigned++;
      if (!dryRun) await famDoc.ref.update({ publicFid });
    }

    const memberSnap = await famDoc.ref
      .collection('members')
      .orderBy('joinedAt', 'asc')
      .get();
    for (const memDoc of memberSnap.docs) {
      membersScanned++;
      const mem = memDoc.data() as { publicMid?: string };
      if (mem.publicMid) continue;
      const [publicMid] = await allocators.allocateMemberPublicIds(1);
      rows.push({ kind: 'member', oldId: memDoc.id, newId: publicMid!, fid: famDoc.id });
      membersAssigned++;
      if (!dryRun) await memDoc.ref.update({ publicMid: publicMid! });
    }
  }

  return { rows, familiesScanned, familiesAssigned, membersScanned, membersAssigned };
}

// ── CLI wrapper ───────────────────────────────────────────────────────────────

interface Args extends AssignOpts {
  csvOut: string | null;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: false,
    limit: null,
    fid: null,
    csvOut: null,
    allowProd: false,
  };
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

function fmtRow(r: MappingRow): string {
  return [r.kind, r.oldId, r.newId, r.fid]
    .map((v) => String(v).replace(/[",\n]/g, ' '))
    .map((v) => `"${v}"`)
    .join(',');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const projectId = process.env.PORTAL_FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error('REFUSED: PORTAL_FIREBASE_PROJECT_ID must be set in .env.local');
    process.exit(1);
  }
  if (projectId !== 'chinmaya-setu-uat' && !args.allowProd) {
    console.error(
      `REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${projectId}", expected "chinmaya-setu-uat". Pass --allow-prod to bypass.`,
    );
    process.exit(1);
  }

  // Imported lazily so unit tests never load the `server-only` allocator module.
  const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
  const { allocateFamilyPublicId, allocateMemberPublicIds } = await import(
    '@/features/setu/ids/public-id-allocator'
  );

  console.log(`\nPublic-id backfill (issue #4)`);
  console.log(`  Write to:   ${projectId} (Firestore${args.dryRun ? ', DRY-RUN — no writes' : ''})`);
  if (args.limit !== null) console.log(`  Limit:      first ${args.limit} families`);
  if (args.fid !== null) console.log(`  Filter:     fid=${args.fid} only`);
  if (args.csvOut) console.log(`  CSV out:    ${args.csvOut}`);
  console.log('');

  const db = portalFirestore();
  const result = await assignPublicIds(
    db,
    { allocateFamilyPublicId, allocateMemberPublicIds },
    { dryRun: args.dryRun, limit: args.limit, fid: args.fid },
  );

  for (const r of result.rows) {
    if (r.kind === 'family') {
      console.log(`  family  ${r.oldId.padEnd(16)} → publicFid ${r.newId}`);
    } else {
      console.log(`  member  ${r.oldId.padEnd(16)} → publicMid ${r.newId}  (fid ${r.fid})`);
    }
  }

  console.log(`\nSummary${args.dryRun ? ' (DRY-RUN — no writes)' : ''}:`);
  console.log(`  Families scanned:   ${result.familiesScanned}`);
  console.log(`  Families assigned:  ${result.familiesAssigned}`);
  console.log(`  Members scanned:    ${result.membersScanned}`);
  console.log(`  Members assigned:   ${result.membersAssigned}`);
  console.log(`  Skipped (already had a public id): ${result.familiesScanned - result.familiesAssigned} families, ${result.membersScanned - result.membersAssigned} members`);

  if (args.csvOut) {
    const header = 'kind,oldId,newId,fid\n';
    const body = result.rows.map(fmtRow).join('\n');
    writeFileSync(args.csvOut, header + body + (result.rows.length ? '\n' : ''), 'utf-8');
    console.log(`\nCSV mapping written to ${args.csvOut}`);
  }
}

// Only auto-run as a CLI; importing the module (e.g. in tests) does not execute.
if (process.argv[1] && /assign-public-ids\.(ts|js)$/.test(process.argv[1])) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('Fatal:', e);
      process.exit(1);
    });
}
