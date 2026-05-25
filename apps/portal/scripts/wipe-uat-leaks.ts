// One-off cleanup — deletes every family doc + subcollection in UAT
// EXCEPT the protected ones (currently just GY9OART03HDC, the Matta family).
// Also sweeps orphan contactKeys, orphan members in ghost family docs, and
// orphan auth users tied to any wiped fid.
//
// Usage: pnpm --filter @cmt/portal exec tsx scripts/wipe-uat-leaks.ts
// MUST run against UAT only (chinmaya-setu-uat). Refuses if pointed at prod.
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';

const PROTECTED_FIDS = new Set(['GY9OART03HDC']);

async function main() {
  const wipeAll = process.argv.includes('--all');
  const protectedFids: Set<string> = wipeAll ? new Set<string>() : PROTECTED_FIDS;

  const projectId = process.env.PORTAL_FIREBASE_PROJECT_ID;
  if (projectId !== 'chinmaya-setu-uat') {
    console.error(`REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${projectId}", expected "chinmaya-setu-uat"`);
    process.exit(1);
  }

  const db = portalFirestore();
  const refs = await db.collection('families').listDocuments();
  console.log(`\nFound ${refs.length} family doc refs in ${projectId}`);
  if (wipeAll) {
    console.log(`Mode: --all → wiping EVERYTHING (no protected fids)\n`);
  } else {
    console.log(`Protected (will NOT delete): ${[...protectedFids].join(', ')}\n`);
  }

  const fidsToWipe: string[] = [];

  for (const ref of refs) {
    if (protectedFids.has(ref.id)) {
      console.log(`SKIP   fid=${ref.id} (protected)`);
      continue;
    }

    const doc = await ref.get();
    const members = await ref.collection('members').listDocuments();
    const invites = await ref.collection('invites').listDocuments();

    // Delete every doc in members subcollection
    for (const m of members) {
      await m.delete();
    }
    // Delete every doc in invites subcollection
    for (const i of invites) {
      await i.delete();
    }
    // Delete the family doc itself (no-op if it was already a ghost)
    if (doc.exists) {
      await ref.delete();
    }

    fidsToWipe.push(ref.id);
    console.log(`WIPED  fid=${ref.id}  members=${members.length}  invites=${invites.length}  ${doc.exists ? '(real)' : '(ghost)'}`);
  }

  // Sweep contactKeys whose family field points to a wiped fid, OR all _test:true contactKeys
  console.log('\nSweeping contactKeys…');
  const allCKsByTest = await db.collection('contactKeys').where('_test', '==', true).get();
  for (const ck of allCKsByTest.docs) {
    await ck.ref.delete();
    console.log(`  removed contactKey ${ck.id} (_test=true)`);
  }
  // Also sweep CKs that reference a wiped fid
  for (const fid of fidsToWipe) {
    const matches = await db.collection('contactKeys').where('fid', '==', fid).get();
    for (const ck of matches.docs) {
      await ck.ref.delete();
      console.log(`  removed contactKey ${ck.id} (fid=${fid})`);
    }
  }

  // Sweep auth users tied to wiped fids via custom claims
  console.log('\nSweeping auth users…');
  const auth = portalAuth();
  let pageToken: string | undefined;
  let userSwept = 0;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      const claims = (u.customClaims ?? {}) as Record<string, unknown>;
      const fid = typeof claims.fid === 'string' ? claims.fid : null;
      if (fid && fidsToWipe.includes(fid)) {
        await auth.deleteUser(u.uid);
        console.log(`  removed auth user ${u.uid} (fid=${fid}, email=${u.email ?? '?'})`);
        userSwept++;
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  console.log(`\nDone. Wiped ${fidsToWipe.length} families, ${userSwept} auth users.`);
  console.log(`Survivors: ${[...PROTECTED_FIDS].join(', ')}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
