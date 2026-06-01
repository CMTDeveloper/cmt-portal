/**
 * Read-only UAT migration + index diagnostic.
 *
 * Answers: "have the multi-program migrations run, and why does
 * /admin/programs/<key> error?" Reads only chinmaya-setu-uat; writes nothing.
 *
 * Run: pnpm --filter @cmt/portal check:migrations
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

async function main(): Promise<void> {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  console.log(`\n=== UAT migration check — project: ${projectId} ===\n`);
  if (projectId !== 'chinmaya-setu-uat') {
    console.error('REFUSING: PORTAL_FIREBASE_PROJECT_ID is not chinmaya-setu-uat.');
    process.exit(1);
  }

  const db = portalFirestore();

  // 1) programs registry
  const progSnap = await db.collection('programs').get();
  console.log(`programs collection: ${progSnap.size} doc(s)`);
  for (const d of progSnap.docs) {
    const p = d.data();
    console.log(`  - ${d.id}: label="${p['label']}" status=${p['status']} term=${p['termType']}`);
  }
  console.log(`  bala-vihar program present: ${progSnap.docs.some((d) => d.id === 'bala-vihar') ? 'YES' : 'NO'}\n`);

  // 2) offerings — per-offering detail (location/enabled/endDate decide whether
  // a family sees the program on /family/programs).
  const offSnap = await db.collection('offerings').get();
  const byProgram: Record<string, number> = {};
  const isoDay = (v: unknown): string =>
    v == null
      ? 'null'
      : typeof (v as { toDate?: unknown }).toDate === 'function'
        ? (v as { toDate: () => Date }).toDate().toISOString().slice(0, 10)
        : String(v);
  console.log(`offerings collection: ${offSnap.size} doc(s)`);
  for (const d of offSnap.docs) {
    const o = d.data();
    const k = (o['programKey'] as string) ?? '(none)';
    byProgram[k] = (byProgram[k] ?? 0) + 1;
    console.log(
      `  - ${k} | oid=${o['oid']} | location=${o['location'] ?? 'null(location-less)'} | enabled=${o['enabled']} | term=${o['termLabel']} | ${isoDay(o['startDate'])} → ${isoDay(o['endDate'])}`,
    );
  }
  console.log(`  by programKey: ${JSON.stringify(byProgram)}\n`);

  // 3) legacy donationPeriods (additive migration leaves these intact)
  const dpSnap = await db.collection('donationPeriods').get();
  console.log(`donationPeriods (legacy) collection: ${dpSnap.size} doc(s)\n`);

  // 4) reproduce the failing admin query: offerings where programKey == X orderBy startDate desc
  console.log(`Admin query  offerings.where(programKey==bala-vihar).orderBy(startDate desc):`);
  try {
    const q = await db
      .collection('offerings')
      .where('programKey', '==', 'bala-vihar')
      .orderBy('startDate', 'desc')
      .get();
    console.log(`  OK — returned ${q.size} offering(s). Composite index IS present.\n`);
  } catch (err) {
    const e = err as { code?: unknown; message?: string };
    console.error(`  THREW  code=${String(e.code)}  ${e.message}\n`);
  }

  // 5) enrollment migration — sample collectionGroup enrollments for new vs old fields
  const enrSnap = await db.collectionGroup('enrollments').limit(25).get();
  let oid = 0;
  let pid = 0;
  let programKey = 0;
  for (const d of enrSnap.docs) {
    const e = d.data();
    if (e['oid'] !== undefined) oid++;
    if (e['pid'] !== undefined) pid++;
    if (e['programKey'] !== undefined) programKey++;
  }
  console.log(`enrollments (sample ${enrSnap.size}): have oid=${oid}, have programKey=${programKey}, still have pid=${pid}\n`);

  // 6) families
  const famAgg = await db.collection('families').count().get();
  console.log(`families: ${famAgg.data().count}\n`);

  console.log('=== done (read-only) ===\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
