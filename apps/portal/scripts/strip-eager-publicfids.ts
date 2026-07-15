/**
 * Strip the eager, pre-lazy-model `publicFid` from families that shouldn't have
 * one yet. UAT was renumbered to the 5001+ band for EVERY family before the lazy
 * `publicFid` model (§14 2026-07-14), so the `/welcome/roster` list shows a new
 * Family ID even on families that have never enrolled — contradicting the model
 * (a `publicFid` is minted only at first enrollment). This resets those families
 * to `publicFid:null` so UAT reflects prod's lazy behavior.
 *
 * Scope (default): families with NO active enrollment (in any year). Pass
 * `--never-enrolled-only` to narrow to families with NO enrollment doc at all
 * (leaves lapsed families that once enrolled untouched — the strict-persistence
 * reading). `_test:true` fixture families are ALWAYS skipped (seeds own them).
 *
 * DRY-RUN by default; --apply to write. UAT-only: refuses unless
 * PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat (--allow-prod to override — but
 * prod is already lazy, so this should never be needed there).
 *
 *   pnpm --filter @cmt/portal strip:eager-publicfids
 *   pnpm --filter @cmt/portal strip:eager-publicfids -- --apply
 */
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';

async function main(): Promise<void> {
  const project = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '';
  const apply = process.argv.includes('--apply');
  const neverOnly = process.argv.includes('--never-enrolled-only');
  if (project !== 'chinmaya-setu-uat' && !process.argv.includes('--allow-prod')) {
    throw new Error(`REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${project}", expected "chinmaya-setu-uat". Pass --allow-prod to bypass.`);
  }

  const db = portalFirestore();

  // Bulk: active + any enrollment counts per fid.
  const enr = await db.collectionGroup('enrollments').get();
  const activeByFid = new Map<string, number>();
  const anyByFid = new Map<string, number>();
  for (const e of enr.docs) {
    const fid = e.ref.parent.parent?.id;
    if (!fid) continue;
    anyByFid.set(fid, (anyByFid.get(fid) ?? 0) + 1);
    if ((e.data() as { status?: unknown }).status === 'active') activeByFid.set(fid, (activeByFid.get(fid) ?? 0) + 1);
  }

  const fams = await db.collection('families').get();
  const targets: Array<{ fid: string; name: string; publicFid: string }> = [];
  let skippedTest = 0;
  for (const f of fams.docs) {
    const d = f.data() as { publicFid?: unknown; name?: unknown; _test?: unknown };
    const publicFid = typeof d.publicFid === 'string' && d.publicFid ? d.publicFid : null;
    if (!publicFid) continue;
    if (d._test === true) { skippedTest++; continue; }
    const hasActive = (activeByFid.get(f.id) ?? 0) > 0;
    const hasAny = (anyByFid.get(f.id) ?? 0) > 0;
    const strip = neverOnly ? !hasAny : !hasActive;
    if (strip) targets.push({ fid: f.id, name: typeof d.name === 'string' ? d.name : f.id, publicFid });
  }

  const mode = neverOnly ? 'never-enrolled (no enrollment doc at all)' : 'no active enrollment (any year)';
  console.log(`\n${apply ? 'APPLY' : 'DRY-RUN'} on ${project}`);
  console.log(`scope: ${mode}`);
  console.log(`${fams.size} families; ${targets.length} to strip; ${skippedTest} _test families skipped\n`);
  for (const t of targets.slice(0, 15)) console.log(`  ${apply ? 'strip' : 'would strip'} ${t.fid} (${t.name}) publicFid ${t.publicFid} -> null`);
  if (targets.length > 15) console.log(`  … and ${targets.length - 15} more`);

  if (apply) {
    let n = 0;
    for (const t of targets) {
      await db.collection('families').doc(t.fid).update({ publicFid: FieldValue.delete() });
      n++;
    }
    console.log(`\nStripped ${n} publicFid(s).`);
  } else {
    console.log(`\nDry-run only. Re-run with --apply to write.`);
  }
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
