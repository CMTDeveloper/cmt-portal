/**
 * Re-number every family publicFid that ALSO equals some family's legacy check-in
 * id, so no publicFid ever collides with a legacy id.
 *
 * WHY: the kiosk resolves LEGACY-first (families use their legacy id at the door),
 * and ~60% of publicFids happen to equal another family's legacy id. That makes the
 * "use your new Family ID" nudge send those families to the WRONG family. Giving
 * publicFids a namespace disjoint from legacy ids fixes both the resolution and the
 * nudge. Setu is unannounced, so re-numbering is low impact.
 *
 * WHAT: colliding publicFids are re-assigned to fresh numbers in the counter's
 * forward range (>= its current `next`), skipping any number that is a legacy id or
 * an existing publicFid. The 354 non-colliding families keep their ids. publicFid is
 * stored ONLY on families/{fid}.publicFid (verified: not in searchKeys, not a doc id,
 * not referenced elsewhere), so a field update is sufficient. The familyPublicId
 * counter is advanced past the re-numbered block.
 *
 * Idempotent: a re-run finds no colliding publicFids and is a no-op.
 *
 * Modes: default is a DRY-RUN (prints the plan, no writes). Pass --apply to write.
 * Refuses any project that is not chinmaya-setu-uat unless --allow-prod is given.
 *
 * Run: pnpm --filter @cmt/portal renumber:public-ids            # dry-run
 *      pnpm --filter @cmt/portal renumber:public-ids --apply    # write (UAT)
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

const DRY_RUN = !process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');
const FAMILY_COUNTER = 'familyPublicId';
const FAMILY_START = 1001;

async function main() {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  if (projectId !== 'chinmaya-setu-uat' && !ALLOW_PROD) {
    console.error(
      `REFUSING: PORTAL_FIREBASE_PROJECT_ID is ${projectId ?? '(unset)'}, not chinmaya-setu-uat. Pass --allow-prod to run against prod (deliberate).`,
    );
    process.exit(1);
  }
  const db = portalFirestore();

  console.log(`=== renumber-colliding-public-ids - project: ${projectId} (${DRY_RUN ? 'DRY-RUN' : 'APPLY'}) ===`);

  const snap = await db.collection('families').get();
  const legacyIds = new Set<string>();
  const publicFids = new Set<string>();
  type Fam = { fid: string; publicFid: string | null; legacyFid: string | null; name: string };
  const fams: Fam[] = [];
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    const publicFid = typeof x.publicFid === 'string' ? x.publicFid : null;
    const legacyFid = typeof x.legacyFid === 'string' ? x.legacyFid : null;
    if (legacyFid) legacyIds.add(legacyFid);
    if (publicFid) publicFids.add(publicFid);
    fams.push({ fid: d.id, publicFid, legacyFid, name: typeof x.name === 'string' ? x.name : d.id });
  }

  // Colliding = this family's publicFid is ALSO some family's legacy id.
  const colliding = fams
    .filter((f): f is Fam & { publicFid: string } => f.publicFid !== null && legacyIds.has(f.publicFid))
    .sort((a, b) => a.fid.localeCompare(b.fid));

  console.log(`families=${snap.size} | legacy ids=${legacyIds.size} | colliding publicFids=${colliding.length}`);
  if (colliding.length === 0) {
    console.log('Nothing to do - every publicFid is already disjoint from the legacy ids.');
    return;
  }

  // Clean-number cursor: start at the counter's current next so re-numbered ids land
  // in the forward range and the counter can advance past them. reserved = all legacy
  // ids and all existing publicFids (kept + reassigned), so we never reuse a number.
  const counterSnap = await db.collection('counters').doc(FAMILY_COUNTER).get();
  let cursor = counterSnap.exists ? Number(counterSnap.data()?.next ?? FAMILY_START) : FAMILY_START;
  if (!Number.isFinite(cursor)) cursor = FAMILY_START;
  const reserved = new Set<string>([...legacyIds, ...publicFids]);
  const nextClean = (): string => {
    while (reserved.has(String(cursor))) cursor++;
    const n = String(cursor);
    reserved.add(n);
    cursor++;
    return n;
  };

  const plan = colliding.map((f) => ({ fid: f.fid, name: f.name, old: f.publicFid, next: nextClean() }));
  console.log('\nPLAN (first 10 of', plan.length, '):');
  for (const p of plan.slice(0, 10)) console.log(`  ${p.name} (${p.fid}): publicFid ${p.old} -> ${p.next}`);
  console.log(
    `  new-id range ${plan[0]?.next}..${plan[plan.length - 1]?.next}; counter next -> ${cursor} (was ${counterSnap.data()?.next ?? FAMILY_START}).`,
  );

  if (DRY_RUN) {
    console.log('\nDRY-RUN - no writes performed. Re-run with --apply to write.');
    return;
  }

  let batch = db.batch();
  let inBatch = 0;
  for (const p of plan) {
    batch.update(db.collection('families').doc(p.fid), { publicFid: p.next });
    if (++inBatch % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();
  await db.collection('counters').doc(FAMILY_COUNTER).set({ next: cursor }, { merge: true });
  console.log(`\nAPPLIED: re-numbered ${plan.length} families; familyPublicId counter next = ${cursor}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
