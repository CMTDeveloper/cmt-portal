/**
 * Re-number EVERY family publicFid into a uniform band starting at 5001, so that
 * publicFids sit ABOVE every real legacy check-in id (legacy ids top out in the
 * low thousands; the lone 99991 is junk). This makes publicFids collision-free
 * with legacy ids AND visually distinct (a 5xxx number reads as "the new ID").
 *
 * WHY: the kiosk resolves LEGACY-first (families use their legacy id at the door)
 * and shows a "use your new Family ID" nudge. If a publicFid equals some family's
 * legacy id, both the resolution and the nudge misroute. Disjoint namespaces fix
 * both. Setu is unannounced, so re-numbering is low impact.
 *
 * WHAT: assigns 5001, 5002, ... to families in fid order (deterministic, so a
 * re-run is a no-op fixpoint), SKIPPING any candidate that is an existing legacy
 * id (belt-and-suspenders; 5001-5999 has none today). publicFid is stored ONLY on
 * families/{fid}.publicFid (audited: not in searchKeys, not a doc id, not
 * referenced elsewhere), so a field update suffices. Member ids (publicMid) are a
 * separate namespace starting at 50001 and are untouched. The familyPublicId
 * counter is advanced past the band.
 *
 * Modes: DRY-RUN by default (prints the plan). Pass --apply to write. Refuses any
 * project that is not chinmaya-setu-uat unless --allow-prod is given.
 *
 * Run: pnpm --filter @cmt/portal renumber:public-ids            # dry-run
 *      pnpm --filter @cmt/portal renumber:public-ids --apply    # write (UAT)
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

const DRY_RUN = !process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');
const FAMILY_COUNTER = 'familyPublicId';
const BASE = 5001;

async function main() {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  if (projectId !== 'chinmaya-setu-uat' && !ALLOW_PROD) {
    console.error(
      `REFUSING: PORTAL_FIREBASE_PROJECT_ID is ${projectId ?? '(unset)'}, not chinmaya-setu-uat. Pass --allow-prod to run against prod (deliberate).`,
    );
    process.exit(1);
  }
  const db = portalFirestore();
  console.log(`=== renumber-public-ids (base ${BASE}) - project: ${projectId} (${DRY_RUN ? 'DRY-RUN' : 'APPLY'}) ===`);

  const snap = await db.collection('families').get();
  const legacyIds = new Set<string>();
  type Fam = { fid: string; publicFid: string | null; name: string };
  const fams: Fam[] = [];
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    if (typeof x.legacyFid === 'string') legacyIds.add(x.legacyFid);
    fams.push({
      fid: d.id,
      publicFid: typeof x.publicFid === 'string' ? x.publicFid : null,
      name: typeof x.name === 'string' ? x.name : d.id,
    });
  }
  // Deterministic order by fid -> a re-run assigns the identical mapping (idempotent).
  fams.sort((a, b) => a.fid.localeCompare(b.fid));

  // Assign a contiguous band from BASE, skipping any number that is a legacy id.
  const reserved = new Set<string>(legacyIds);
  let cursor = BASE;
  const nextClean = (): string => {
    while (reserved.has(String(cursor))) cursor++;
    const n = String(cursor);
    reserved.add(n);
    cursor++;
    return n;
  };

  const plan = fams.map((f) => ({ fid: f.fid, name: f.name, old: f.publicFid ?? '(none)', next: nextClean() }));
  const changed = plan.filter((p) => p.old !== p.next);
  console.log(`families=${snap.size} | legacy ids=${legacyIds.size} | to re-number=${changed.length}`);
  if (changed.length === 0) {
    console.log('Nothing to do - every family already has its target 5001+ id.');
    return;
  }
  console.log('\nPLAN (first 10):');
  for (const p of plan.slice(0, 10)) console.log(`  ${p.name} (${p.fid}): publicFid ${p.old} -> ${p.next}`);
  console.log(`  new-id range ${plan[0]?.next}..${plan[plan.length - 1]?.next}; counter next -> ${cursor}.`);

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
  console.log(`\nAPPLIED: re-numbered ${plan.length} families to ${plan[0]?.next}..${plan[plan.length - 1]?.next}; familyPublicId counter next = ${cursor}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
