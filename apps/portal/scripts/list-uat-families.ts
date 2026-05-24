// One-off read-only inspector — lists every family doc in UAT Firestore
// with its fid, name, _test flag, createdAt, manager count, member count.
// Usage: pnpm --filter @cmt/portal tsx scripts/list-uat-families.ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

async function main() {
  const db = portalFirestore();
  const snap = await db.collection('families').orderBy('createdAt', 'desc').get();
  console.log(`\n=== ${snap.size} families in ${process.env.PORTAL_FIREBASE_PROJECT_ID} ===\n`);

  let testCount = 0;
  let realCount = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    const isTest = d._test === true;
    if (isTest) testCount++; else realCount++;

    const membersSnap = await doc.ref.collection('members').get();
    const created = d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : String(d.createdAt);
    const tag = isTest ? '🧪 TEST  ' : '✅ REAL  ';
    console.log(
      `${tag} fid=${doc.id.padEnd(14)} ` +
      `legacyFid=${String(d.legacyFid ?? '-').padEnd(6)} ` +
      `name="${d.name ?? '?'}".padEnd(20)} ` +
      `members=${membersSnap.size}  ` +
      `managers=${(d.managers ?? []).length}  ` +
      `created=${created}`,
    );
  }

  console.log(`\nSummary: ${realCount} real, ${testCount} test, ${snap.size} total`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
