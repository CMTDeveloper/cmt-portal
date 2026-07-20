/**
 * Clear the school-year rollover's auto carry-forward enrollments in UAT.
 *
 * The OLD rollover (pre-2026-07-20) wrote a brand-new active enrollment for the
 * new year with `enrolledVia: 'promotion'` for every family that had enrolled the
 * prior year. Those carry-forwards are exactly what shows as "Registered" and
 * inflate the roster. The NEW rollover no longer creates them (it only bumps
 * grades + remaps levels), so DELETING the existing promotion enrollments makes
 * UAT match the new model: the family keeps its promoted grades + cancelled
 * prior-year record, but has NO active new-year enrollment until it re-enrolls.
 *
 * ONLY touches `enrolledVia: 'promotion'` + `status: 'active'` enrollments. Real
 * engagement (welcome-team / first-attendance / family-initiated / kiosk) and
 * every family/member doc are left completely untouched. Does NOT strip publicFid.
 *
 * DRY-RUN BY DEFAULT. Pass --commit to delete. Refuses unless UAT.
 *   pnpm --filter @cmt/portal clear:promotion-carryforwards            # dry-run
 *   pnpm --filter @cmt/portal clear:promotion-carryforwards --commit   # execute
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

async function main() {
  const commit = process.argv.includes('--commit');
  const projectId = process.env.PORTAL_FIREBASE_PROJECT_ID;
  if (projectId !== 'chinmaya-setu-uat') {
    console.error(`REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${projectId}", expected "chinmaya-setu-uat"`);
    process.exit(1);
  }
  console.log(`\n=== clear-promotion-carryforwards (${commit ? 'COMMIT' : 'DRY-RUN'}) on ${projectId} ===\n`);

  const db = portalFirestore();

  // Read families first so we can PRESERVE `_test:true` fixtures — the Playwright
  // suite depends on some promotion carry-forwards (the "Previous students" E2E
  // fixtures on CMT-E2E-PSIB/PSOLO/ATT + CMT-FSWEDU2X). We clear only the real
  // migrated-family carry-forwards.
  const famSnap = await db.collection('families').get();
  const testFids = new Set<string>();
  const nameByFid = new Map<string, string>();
  for (const f of famSnap.docs) {
    const fd = f.data() as Record<string, unknown>;
    if (fd['_test'] === true) testFids.add(f.id);
    nameByFid.set(f.id, (fd['name'] as string) ?? f.id);
  }

  // Index-free: read ALL enrollments (collectionGroup, no filter) and select the
  // active promotion carry-forwards in memory (a status/enrolledVia composite
  // index is not deployed; the unfiltered collectionGroup read needs none).
  const snap = await db.collectionGroup('enrollments').get();
  const targets: Array<{ ref: FirebaseFirestore.DocumentReference; fid: string; eid: string; pid: string; via: string }> = [];
  const viaBreakdown: Record<string, number> = {};
  let activeTotal = 0;
  let skippedTest = 0;
  for (const d of snap.docs) {
    const e = d.data() as Record<string, unknown>;
    if (e['status'] !== 'active') continue;
    activeTotal++;
    const via = String(e['enrolledVia'] ?? 'unknown');
    viaBreakdown[via] = (viaBreakdown[via] ?? 0) + 1;
    if (via !== 'promotion') continue;
    const fid = (e['fid'] as string) ?? d.ref.parent.parent?.id ?? '?';
    if (testFids.has(fid)) { skippedTest++; continue; } // preserve E2E fixtures
    targets.push({ ref: d.ref, fid, eid: (e['eid'] as string) ?? d.id, pid: (e['pid'] as string) ?? '?', via });
  }

  console.log(`enrollments scanned: ${snap.size}  (active: ${activeTotal})`);
  console.log('active enrolledVia breakdown:', viaBreakdown);
  console.log(`promotion carry-forwards preserved on _test fixtures: ${skippedTest}`);
  console.log(`\npromotion carry-forwards to DELETE (non-_test): ${targets.length}\n`);

  console.log('first 10 targets:');
  for (const t of targets.slice(0, 10)) console.log(`   ${t.fid.padEnd(16)} "${nameByFid.get(t.fid)}" pid=${t.pid}`);
  if (targets.length > 10) console.log(`   … and ${targets.length - 10} more`);

  if (!commit) {
    console.log(`\n[DRY-RUN] nothing deleted. Re-run with --commit to execute.\n`);
    return;
  }

  console.log(`\nDeleting ${targets.length} promotion enrollments…`);
  let done = 0;
  for (const t of targets) {
    await t.ref.delete();
    if (++done % 50 === 0) console.log(`   … ${done}/${targets.length}`);
  }
  console.log(`\nDone. Deleted ${done} promotion carry-forward enrollments. Families/members untouched.`);

  // Report families now left with a publicFid but no active enrollment (info only —
  // NOT stripped here; the FID is kept, consistent with "minted at first enrollment,
  // permanent"). Offer a separate strip step if a fully FID-clean roster is wanted.
  const stillActive = new Set<string>();
  for (const d of (await db.collectionGroup('enrollments').get()).docs) {
    const e = d.data() as Record<string, unknown>;
    if (e['status'] === 'active') stillActive.add((e['fid'] as string) ?? d.ref.parent.parent?.id ?? '?');
  }
  let fidNoEnroll = 0;
  for (const f of famSnap.docs) {
    const fd = f.data() as Record<string, unknown>;
    if (fd['publicFid'] != null && !stillActive.has(f.id)) fidNoEnroll++;
  }
  console.log(`Info: ${fidNoEnroll} families now have a publicFid but no active enrollment (FIDs left intact).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e?.stack ?? e?.message ?? e); process.exit(1); });
