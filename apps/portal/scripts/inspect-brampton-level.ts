/**
 * Read-only UAT inspector for the Brampton Bala Vihar teacher roster.
 *
 * Answers: "why does /teacher/levels/brampton-level-1-bv-brampton-2025-26 show
 * only 1 student?" by reproducing deriveRoster()'s data path without the Next
 * render context:
 *   1. levels matching the Brampton 2025-26 period (id + kind + gradeBand)
 *   2. active enrollments where pid == bv-brampton-2025-26 (collectionGroup)
 *   3. for each enrolled family, the members + their schoolGrade
 *   4. simulate memberMatchesLevel() per level → projected roster sizes
 *   5. the school-grade histogram among currently-enrolled Brampton kids
 *
 * Writes NOTHING. UAT only (refuses any other project).
 *
 * Run: pnpm --filter @cmt/portal exec tsx --env-file=.env.local \
 *        scripts/inspect-brampton-level.ts
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { memberMatchesLevel, type LevelKind } from '@cmt/shared-domain';

const PID = 'bv-brampton-2025-26';
const LOCATION = 'Brampton';

async function main(): Promise<void> {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  console.log(`\n=== Brampton roster inspector — project: ${projectId} ===\n`);
  if (projectId !== 'chinmaya-setu-uat') {
    console.error('REFUSING: PORTAL_FIREBASE_PROJECT_ID is not chinmaya-setu-uat.');
    process.exit(1);
  }
  const db = portalFirestore();
  const now = new Date();

  // 1) Brampton 2025-26 levels
  const levelsSnap = await db.collection('levels').where('pid', '==', PID).get();
  const levels = levelsSnap.docs
    .map((d) => d.data() as { levelId: string; levelName: string; levelKind: LevelKind; gradeBand: string[]; location: string })
    .sort((a, b) => a.levelName.localeCompare(b.levelName));
  console.log(`Brampton 2025-26 levels: ${levels.length}`);
  for (const l of levels) {
    console.log(`  - ${l.levelId}  [${l.levelKind}] band=${JSON.stringify(l.gradeBand)}`);
  }
  console.log('');

  // 2) active enrollments for this pid
  const enrollSnap = await db
    .collectionGroup('enrollments')
    .where('pid', '==', PID)
    .where('status', '==', 'active')
    .get();
  console.log(`active enrollments where pid==${PID}: ${enrollSnap.size}`);

  const enrolledMidsByFid = new Map<string, Set<string>>();
  let nonBramptonLocation = 0;
  for (const d of enrollSnap.docs) {
    const e = d.data() as { fid?: string; location?: string; enrolledMids?: string[] };
    if (e.location !== LOCATION) {
      nonBramptonLocation++;
      continue;
    }
    if (typeof e.fid !== 'string') continue;
    const set = enrolledMidsByFid.get(e.fid) ?? new Set<string>();
    for (const m of e.enrolledMids ?? []) set.add(m);
    enrolledMidsByFid.set(e.fid, set);
  }
  console.log(`  → location==Brampton families: ${enrolledMidsByFid.size}  (skipped ${nonBramptonLocation} non-Brampton-location enrollments)`);
  let totalEnrolledMids = 0;
  for (const s of enrolledMidsByFid.values()) totalEnrolledMids += s.size;
  console.log(`  → total enrolledMids: ${totalEnrolledMids}\n`);

  // 3) load members for enrolled families, keep only the enrolled mids
  interface M {
    fid: string;
    mid: string;
    type: 'Adult' | 'Child';
    schoolGrade: string | null;
    birthMonthYear: string | null;
  }
  const members: M[] = [];
  const fids = [...enrolledMidsByFid.keys()];
  for (const fid of fids) {
    const memSnap = await db.collection('families').doc(fid).collection('members').get();
    const enrolled = enrolledMidsByFid.get(fid)!;
    for (const md of memSnap.docs) {
      const m = md.data() as { mid?: string; type?: 'Adult' | 'Child'; schoolGrade?: string | null; birthMonthYear?: string | null };
      if (!m.mid || !enrolled.has(m.mid)) continue;
      members.push({
        fid,
        mid: m.mid,
        type: m.type ?? 'Child',
        schoolGrade: m.schoolGrade ?? null,
        birthMonthYear: m.birthMonthYear ?? null,
      });
    }
  }
  console.log(`enrolled members loaded: ${members.length}`);

  // 4) school-grade histogram among enrolled children
  const gradeHist = new Map<string, number>();
  for (const m of members) {
    if (m.type !== 'Child') continue;
    const key = m.schoolGrade ?? '(null)';
    gradeHist.set(key, (gradeHist.get(key) ?? 0) + 1);
  }
  console.log('school-grade histogram (enrolled children):');
  for (const [g, n] of [...gradeHist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(g).padEnd(10)} ${n}`);
  }
  console.log('');

  // 5) projected roster size per level (memberMatchesLevel)
  console.log('projected roster size per level (memberMatchesLevel):');
  for (const l of levels) {
    const n = members.filter((m) => memberMatchesLevel(m, l, now)).length;
    console.log(`  ${l.levelName.padEnd(14)} band=${JSON.stringify(l.gradeBand).padEnd(14)} → ${n}`);
  }
  console.log('\n=== done (read-only) ===\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
