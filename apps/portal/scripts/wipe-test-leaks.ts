// One-off cleanup — sweeps ONLY `_test:true` leaked docs in UAT left behind by
// failed e2e teardowns. Unlike wipe-uat-leaks.ts this does NOT touch real
// (non-_test) families/offerings/programs — it is safe to run anytime.
//
// Sweeps, in order:
//   - families where _test==true (+ members/invites/enrollments subcollections)
//   - contactKeys where _test==true
//   - donationPeriods where _test==true
//   - offerings where _test==true
//   - programs where _test==true
//   - any orphan enrollments via collectionGroup('enrollments').where('_test',true)
//
// Usage: pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/wipe-test-leaks.ts
// Refuses unless PORTAL_FIREBASE_PROJECT_ID === chinmaya-setu-uat.
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

async function main() {
  const projectId = process.env.PORTAL_FIREBASE_PROJECT_ID;
  if (projectId !== 'chinmaya-setu-uat') {
    console.error(`REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${projectId}", expected "chinmaya-setu-uat"`);
    process.exit(1);
  }

  const db = portalFirestore();
  let counts = { families: 0, members: 0, invites: 0, enrollments: 0, contactKeys: 0, donationPeriods: 0, offerings: 0, programs: 0 };

  // 1. _test families + their subcollections
  const families = await db.collection('families').where('_test', '==', true).get();
  for (const fam of families.docs) {
    const fid = fam.id;
    const members = await db.collection('families').doc(fid).collection('members').listDocuments();
    for (const m of members) { await m.delete(); counts.members++; }
    const invites = await db.collection('families').doc(fid).collection('invites').listDocuments();
    for (const i of invites) { await i.delete(); counts.invites++; }
    const enrolls = await db.collection('families').doc(fid).collection('enrollments').listDocuments();
    for (const e of enrolls) { await e.delete(); counts.enrollments++; }
    await fam.ref.delete();
    counts.families++;
    console.log(`WIPED family ${fid}`);
  }

  // 2. _test contactKeys
  const cks = await db.collection('contactKeys').where('_test', '==', true).get();
  for (const ck of cks.docs) { await ck.ref.delete(); counts.contactKeys++; }

  // 3. _test donationPeriods (legacy collection)
  const periods = await db.collection('donationPeriods').where('_test', '==', true).get();
  for (const p of periods.docs) { await p.ref.delete(); counts.donationPeriods++; }

  // 4. _test offerings
  const offerings = await db.collection('offerings').where('_test', '==', true).get();
  for (const o of offerings.docs) { await o.ref.delete(); counts.offerings++; console.log(`WIPED offering ${o.id}`); }

  // 5. _test programs
  const programs = await db.collection('programs').where('_test', '==', true).get();
  for (const pr of programs.docs) { await pr.ref.delete(); counts.programs++; console.log(`WIPED program ${pr.id}`); }

  // 6. Orphan enrollments via collectionGroup (catches docs whose parent family
  //    was already deleted). Needs the enrollments._test COLLECTION_GROUP index.
  const orphanEnrolls = await db.collectionGroup('enrollments').where('_test', '==', true).get();
  for (const e of orphanEnrolls.docs) { await e.ref.delete(); counts.enrollments++; console.log(`WIPED orphan enrollment ${e.ref.path}`); }

  console.log('\nDone. Swept:', JSON.stringify(counts, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
