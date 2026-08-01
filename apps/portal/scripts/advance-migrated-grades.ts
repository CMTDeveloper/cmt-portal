/**
 * ONE-SHOT: advance every migrated child's `schoolGrade` by one school year.
 *
 * ── Why this exists (it is NOT the annual rollover) ─────────────────────────
 * At the 2026-07-31 prod cutover, `migrate-legacy-families` copied each child's
 * grade verbatim out of the legacy RTDB roster. That snapshot holds **2025-26**
 * grades, while `app_config/school_year` is **2026-27** — setting the year
 * promotes nobody. So every migrated child sits one grade behind, and because a
 * level is derived from the grade band, they would land in last year's class.
 *
 * `promote-families.ts` CANNOT fix this: it discovers families by ACTIVE
 * source-year Bala Vihar enrollment, and prod has ZERO enrollments by design
 * (the lazy model, plus the 2026-07-24 decision to skip `backfill-bv-enrollments`).
 * Measured on prod: `--from 2025-26 --to 2026-27 --dry-run` → "Families
 * processed: 0". Hence a member-level pass that needs no enrollment.
 *
 * ── Semantics are the ROLLOVER's, not new ones ──────────────────────────────
 * The decision comes from `decidePromotion()` in @cmt/shared-domain — the exact
 * engine the admin rollover uses — and only an `advance` outcome writes, which
 * mirrors `plan-family-promotion.ts:51-52` where `gradeUpdates.push` happens
 * for `advance` ALONE. In particular a Grade 12 child is **left at '12'**:
 * "graduating" in this model means *not advanced*, and inventing a new
 * `graduated` flag here would diverge from the rollover. Confirmed by CMT
 * Developer 2026-07-31 ("grade 12 should graduate").
 *
 * ── Idempotency ────────────────────────────────────────────────────────────
 * Advancing is NOT naturally idempotent (a second run turns 2 into 3), so an
 * advanced member is stamped `gradeSchoolYear` and skipped on any re-run. The
 * field is additive and unknown to `MemberDocSchema`, which is a plain
 * `z.object()` — Zod STRIPS unknown keys rather than throwing, so no reader
 * breaks and no schema change is needed. Nothing else consults it: next year's
 * real rollover is enrollment-driven and ignores it entirely.
 *
 * Dry-run by default. Refuses a non-UAT project without --allow-prod.
 *
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/advance-migrated-grades.ts --csv-out /tmp/grades.csv
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/advance-migrated-grades.ts --apply --allow-prod
 */
import { writeFileSync } from 'node:fs';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { decidePromotion } from '@cmt/shared-domain/setu';

/** The year the advanced grades belong to. Stamped as the idempotency marker. */
const TARGET_YEAR = '2026-27';
/** Firestore caps a batch at 500 writes; stay under it. */
const BATCH_SIZE = 400;

function flag(name: string): boolean {
  return process.argv.includes(name);
}
function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

interface Row {
  fid: string;
  mid: string;
  name: string;
  location: string;
  outcome: string;
  fromGrade: string;
  toGrade: string;
}

async function main() {
  const project = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '(unset)';
  const apply = flag('--apply');
  const allowProd = flag('--allow-prod');
  const limit = opt('--limit') ? Number(opt('--limit')) : null;
  const onlyFid = opt('--fid') ?? null;
  const csvOut = opt('--csv-out') ?? null;

  if (project !== 'chinmaya-setu-uat' && !allowProd) {
    console.error(`REFUSING: PORTAL_FIREBASE_PROJECT_ID is "${project}". Pass --allow-prod to bypass.`);
    process.exitCode = 1;
    return;
  }

  const db = portalFirestore();
  console.log(`project: ${project}   target year: ${TARGET_YEAR}   ${apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}\n`);

  // Two BULK reads, never a per-family fan-out (that times out at this size).
  const famSnap = await db.collection('families').get();
  const families = new Map<string, { location: string; isTest: boolean }>();
  for (const f of famSnap.docs) {
    const d = f.data();
    families.set(f.id, { location: String(d['location'] ?? ''), isTest: d['_test'] === true });
  }
  const memberSnap = await db.collectionGroup('members').get();
  console.log(`read ${famSnap.size} families, ${memberSnap.size} members\n`);

  const now = new Date();
  const rows: Row[] = [];
  const writes: { ref: FirebaseFirestore.DocumentReference; grade: string }[] = [];
  const counts = { advanced: 0, graduated: 0, shishuStays: 0, shishuAgedOut: 0, needsGrade: 0, alreadyDone: 0, skippedTest: 0, noGrade: 0 };

  for (const m of memberSnap.docs) {
    const fid = m.ref.parent.parent?.id;
    if (!fid) continue;
    if (onlyFid && fid !== onlyFid) continue;
    const fam = families.get(fid);
    if (!fam) continue;
    if (fam.isTest) { counts.skippedTest++; continue; }

    const d = m.data();
    const schoolGrade = (d['schoolGrade'] ?? null) as string | null;
    const birthMonthYear = (d['birthMonthYear'] ?? null) as string | null;

    // Adults and anyone without a grade or birth month are not children to promote.
    if ((schoolGrade == null || schoolGrade.trim() === '') && birthMonthYear == null) { counts.noGrade++; continue; }

    if (d['gradeSchoolYear'] === TARGET_YEAR) { counts.alreadyDone++; continue; }

    const outcome = decidePromotion({ schoolGrade, birthMonthYear }, now);
    const name = `${d['firstName'] ?? ''} ${d['lastName'] ?? ''}`.trim();
    const base = { fid, mid: m.id, name, location: fam.location, fromGrade: schoolGrade ?? '' };

    switch (outcome.kind) {
      case 'advance':
        counts.advanced++;
        rows.push({ ...base, outcome: 'advance', toGrade: outcome.to });
        writes.push({ ref: m.ref, grade: outcome.to });
        break;
      case 'graduate':
        // Deliberately NO write - mirrors the rollover engine. Stays at '12'.
        counts.graduated++;
        rows.push({ ...base, outcome: 'graduate', toGrade: '' });
        break;
      case 'shishu-stays':
        counts.shishuStays++;
        rows.push({ ...base, outcome: 'shishu-stays', toGrade: '' });
        break;
      case 'shishu-aged-out':
        counts.shishuAgedOut++;
        rows.push({ ...base, outcome: 'shishu-aged-out', toGrade: '' });
        break;
      case 'needs-grade':
        counts.needsGrade++;
        rows.push({ ...base, outcome: 'needs-grade', toGrade: '' });
        break;
    }
    if (limit != null && counts.advanced >= limit) break;
  }

  // Per-grade preview so a wrong direction is obvious BEFORE writing.
  const transitions = new Map<string, number>();
  for (const r of rows) if (r.outcome === 'advance') {
    const k = `${r.fromGrade} → ${r.toGrade}`;
    transitions.set(k, (transitions.get(k) ?? 0) + 1);
  }
  console.log('transitions:');
  for (const [k, n] of [...transitions.entries()].sort()) console.log(`   ${k.padEnd(14)} ${n}`);

  console.log('\nsummary:');
  console.log(`   advance        ${counts.advanced}`);
  console.log(`   graduate (12)  ${counts.graduated}   (left at '12' on purpose - same as the rollover)`);
  console.log(`   shishu stays   ${counts.shishuStays}`);
  console.log(`   shishu aged out${counts.shishuAgedOut}`);
  console.log(`   needs grade    ${counts.needsGrade}`);
  console.log(`   already done   ${counts.alreadyDone}`);
  console.log(`   no grade/adult ${counts.noGrade}`);
  console.log(`   _test skipped  ${counts.skippedTest}`);

  if (counts.needsGrade > 0) {
    console.log('\nneeds-grade (left untouched, fix the grade then re-run):');
    for (const r of rows.filter((x) => x.outcome === 'needs-grade').slice(0, 20)) {
      console.log(`   ${r.fid}/${r.mid}  ${r.name}  grade=${JSON.stringify(r.fromGrade)}`);
    }
  }

  if (csvOut) {
    const csv = ['fid,mid,name,location,outcome,fromGrade,toGrade']
      .concat(rows.map((r) => [r.fid, r.mid, r.name, r.location, r.outcome, r.fromGrade, r.toGrade].map(csvCell).join(',')))
      .join('\n');
    writeFileSync(csvOut, `${csv}\n`);
    console.log(`\nCSV → ${csvOut} (${rows.length} rows)`);
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.');
    return;
  }

  let written = 0;
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + BATCH_SIZE)) {
      batch.set(w.ref, { schoolGrade: w.grade, gradeSchoolYear: TARGET_YEAR }, { merge: true });
    }
    await batch.commit();
    written += Math.min(BATCH_SIZE, writes.length - i);
    console.log(`   committed ${written}/${writes.length}`);
  }
  console.log(`\nDone. ${written} children advanced to their ${TARGET_YEAR} grade.`);
}

/** Neutralize CSV formula injection - a name could start with = + - @. */
function csvCell(v: string): string {
  const s = String(v ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

void main();
