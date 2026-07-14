/**
 * Reset one or more families to the "pending / not-yet-engaged" state so the
 * lazy-publicFid flow (Model Y2) can be re-tested end to end:
 *   - strips `families/{fid}.publicFid` (so the dashboard shows the
 *     "Assigned when you enroll" nudge again);
 *   - deletes the family's `enrollments` subcollection docs (so the enroll CTA
 *     reappears and the next enrollment mints a fresh publicFid);
 *   - deletes the family's `donations` (top-level, `fid ==`) UNLESS
 *     --keep-donations (a completed donation would otherwise auto-confirm the
 *     family as "Enrolled" via the issue-#23 rule).
 *
 * Does NOT touch attendance events (leftover attendance can re-confirm a family
 * on re-enroll; pass the mids to a teacher un-mark if you need a fully clean #23
 * state). The family record, members and contactKeys are left intact.
 *
 * Identify families by any mix of: --fid CMT-... / --legacy-fid 1257,477 /
 * --email a@b.com (repeatable or comma-separated).
 *
 * DRY-RUN by default (prints current state + what it WOULD delete). Pass --apply
 * to write. UAT-only: refuses unless PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat,
 * --allow-prod to override.
 *
 *   pnpm --filter @cmt/portal reset:family-to-pending -- --legacy-fid 1257,477
 *   pnpm --filter @cmt/portal reset:family-to-pending -- --legacy-fid 1257,477 --apply
 */
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';

type Db = ReturnType<typeof portalFirestore>;

function argValues(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) {
      out.push(...process.argv[i + 1]!.split(',').map((s) => s.trim()).filter(Boolean));
    }
  }
  return out;
}

async function resolveFids(db: Db): Promise<Set<string>> {
  const fids = new Set<string>();
  for (const fid of argValues('--fid')) fids.add(fid);
  for (const legacy of argValues('--legacy-fid')) {
    const snap = await db.collection('families').where('legacyFid', '==', legacy).limit(1).get();
    if (snap.empty) console.warn(`  ! no family with legacyFid=${legacy}`);
    else fids.add(snap.docs[0]!.id);
  }
  for (const email of argValues('--email')) {
    const key = await db.collection('contactKeys').doc(hashContactKey('email', email)).get();
    if (!key.exists) console.warn(`  ! no contactKey for email=${email}`);
    else fids.add((key.data() as { fid: string }).fid);
  }
  return fids;
}

async function main(): Promise<void> {
  const project = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '';
  const apply = process.argv.includes('--apply');
  const keepDonations = process.argv.includes('--keep-donations');
  if (project !== 'chinmaya-setu-uat' && !process.argv.includes('--allow-prod')) {
    throw new Error(`REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${project}", expected "chinmaya-setu-uat". Pass --allow-prod to bypass.`);
  }

  const db = portalFirestore();
  const fids = await resolveFids(db);
  if (fids.size === 0) {
    console.error('No families resolved. Pass --fid / --legacy-fid / --email.');
    process.exit(1);
  }

  console.log(`\n${apply ? 'APPLY' : 'DRY-RUN'} on ${project} - ${fids.size} family(ies)\n`);

  for (const fid of fids) {
    const famRef = db.collection('families').doc(fid);
    const fam = await famRef.get();
    if (!fam.exists) { console.warn(`  ${fid}: NOT FOUND`); continue; }
    const d = fam.data() as { name?: string; publicFid?: string; legacyFid?: string };

    const enrollSnap = await famRef.collection('enrollments').get();
    const donSnap = keepDonations ? null : await db.collection('donations').where('fid', '==', fid).get();

    console.log(`- ${fid} (${d.name ?? '?'}, legacy=${d.legacyFid ?? '-'})`);
    console.log(`    publicFid: ${d.publicFid ?? '(none)'} -> null`);
    console.log(`    enrollments: ${enrollSnap.size} -> delete`);
    console.log(`    donations: ${donSnap ? `${donSnap.size} -> delete` : 'kept'}`);

    if (!apply) continue;

    if (d.publicFid !== undefined) await famRef.update({ publicFid: FieldValue.delete() });
    for (const e of enrollSnap.docs) await e.ref.delete();
    if (donSnap) for (const don of donSnap.docs) await don.ref.delete();
    console.log(`    ...reset done.`);
  }

  console.log(`\n${apply ? 'Done.' : 'Dry-run only. Re-run with --apply to write.'}`);
}

main().then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1); },
);
