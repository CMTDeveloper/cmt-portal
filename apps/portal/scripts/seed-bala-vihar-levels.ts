/**
 * Seed Bala Vihar Levels (classes) per location per school year.
 *
 * Loads the CMT West/Brampton + East/Scarborough level curriculum into levels/
 * in UAT Firestore, one level doc per (location, level, period). Idempotent —
 * re-runs overwrite via set(). Targets UAT by default; refuses prod unless
 * --allow-prod.
 *
 * The level definitions below are the CURRENT (2026-27) curriculum, from CMT's
 * "CMT 2026-27 levels and classes" sheet (Vaibhav, 2026-07-06). When CMT supplies
 * a new year's table, edit the LOCATIONS arrays and re-run with `--year <year>`.
 * (Past years are frozen — their bands/curriculum differ, e.g. 2025-26 West
 * Level 5 = Gr 8–9 / Level 6 = Gr 10; git history has the prior defs.)
 *
 * teacherRefs are PRESERVED across re-runs by default: a level's assigned
 * teachers live in `teacherRefs` (kept in sync with teacherAssignments by
 * assignTeacher()), so a re-seed must NOT wipe them. Pass --reset-teachers to
 * force them back to []. createdAt/createdBy on an existing doc are preserved.
 *
 * gradeBands use the bare-number convention ("2","3") + JK/SK; matching is
 * grade-label-agnostic via normalizeGrade() (handles "Grade 3"/"Gr 3"/"3").
 *
 * Usage:
 *   pnpm --filter @cmt/portal seed:bala-vihar-levels                       # all, 2025-26
 *   pnpm --filter @cmt/portal seed:bala-vihar-levels -- --year 2026-27     # all, 2026-27
 *   pnpm --filter @cmt/portal seed:bala-vihar-levels -- --year 2026-27 --location Brampton
 *   pnpm --filter @cmt/portal seed:bala-vihar-levels -- --year 2026-27 --location Brampton \
 *     --delete-ids brampton-level-1-krishna-bv-brampton-2026-27
 *   pnpm --filter @cmt/portal seed:bala-vihar-levels -- --dry-run
 *   pnpm --filter @cmt/portal seed:bala-vihar-levels -- --year 2026-27 --verify   # read-only: DB == sheet defs?
 *
 * PROD PARITY: the LOCATIONS defs below ARE the single source of truth (CMT's
 * sheet, transcribed + committed). Running `--year 2026-27 --allow-prod` on prod
 * writes byte-identical data to what's in UAT; `--year 2026-27 --verify` then
 * proves it (exit 0 = match, 1 = mismatch). No re-reading the xlsx at cutover.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getPortalApp } from '@cmt/firebase-shared/admin/apps';
import { toSafeSlug, levelSlug, type LevelKind } from '@cmt/shared-domain';

interface ParsedArgs {
  dryRun: boolean;
  allowProd: boolean;
  resetTeachers: boolean;
  verify: boolean;
  year: string;
  location: string | undefined;
  deleteIds: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    dryRun: argv.includes('--dry-run'),
    allowProd: argv.includes('--allow-prod'),
    resetTeachers: argv.includes('--reset-teachers'),
    verify: argv.includes('--verify'),
    year: valueOf('--year') ?? '2025-26',
    location: valueOf('--location'),
    deleteIds: (valueOf('--delete-ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/**
 * Read-only reconciliation: does the target DB match the canonical LOCATIONS defs
 * (the CMT sheet, transcribed once + committed)? Compares the sheet-derived fields
 * — levelKind, gradeBand (order-insensitive), curriculum, enabled — NOT teacherRefs
 * (operational, preserved). Reports MISSING / MISMATCH / extra levels. Returns true
 * iff every expected level is present and matches. Safe on prod (no writes) — the
 * proof that `--year 2026-27 --allow-prod` populated prod with the same data as UAT.
 */
async function verifyLevels(
  db: ReturnType<typeof getFirestore>,
  locations: LocationSeed[],
  year: string,
): Promise<boolean> {
  let ok = true;
  for (const loc of locations) {
    const pid = `bv-${toSafeSlug(loc.location)}-${year}`;
    console.log(`\n▸ ${loc.location} (${pid})`);
    const dbSnap = await db.collection('levels').where('pid', '==', pid).get();
    const dbById = new Map(dbSnap.docs.map((d) => [d.id, d.data()]));
    const expectedIds = new Set<string>();

    for (const lvl of loc.levels) {
      const levelId = `${toSafeSlug(loc.location)}-${levelSlug(lvl.levelName)}-${pid}`;
      expectedIds.add(levelId);
      const doc = dbById.get(levelId);
      if (!doc) {
        console.log(`  ✘ MISSING  ${lvl.levelName} (${levelId})`);
        ok = false;
        continue;
      }
      const diffs: string[] = [];
      if (doc.levelKind !== lvl.levelKind) diffs.push(`kind ${JSON.stringify(doc.levelKind)}≠${JSON.stringify(lvl.levelKind)}`);
      if (doc.curriculum !== lvl.curriculum) diffs.push(`curriculum ${JSON.stringify(doc.curriculum)}≠${JSON.stringify(lvl.curriculum)}`);
      const dbBand = JSON.stringify([...((doc.gradeBand as string[] | undefined) ?? [])].sort());
      const exBand = JSON.stringify([...lvl.gradeBand].sort());
      if (dbBand !== exBand) diffs.push(`band ${JSON.stringify(doc.gradeBand)}≠${JSON.stringify(lvl.gradeBand)}`);
      if (doc.enabled !== true) diffs.push(`enabled=${JSON.stringify(doc.enabled)}`);
      if (diffs.length) {
        console.log(`  ✘ MISMATCH ${lvl.levelName}: ${diffs.join('; ')}`);
        ok = false;
      } else {
        console.log(`  ✔ ${lvl.levelName} [${lvl.gradeBand.join(',') || lvl.levelKind}] ${lvl.curriculum}`);
      }
    }
    // Levels present in the DB but NOT in the sheet defs (e.g. the intentionally
    // kept Brampton "Parents"). Informational — never a failure.
    for (const [id, data] of dbById) {
      if (!expectedIds.has(id)) console.log(`  · extra (not in sheet defs): ${id} name=${JSON.stringify(data.levelName)}`);
    }
  }
  return ok;
}

interface LevelSeed {
  levelName: string;
  levelKind: LevelKind;
  gradeBand: string[];
  ageLabel: string;
  curriculum: string;
}

interface LocationSeed {
  location: 'Brampton' | 'Scarborough';
  levels: LevelSeed[];
}

// Year-agnostic level curriculum per location. pid + periodLabel are derived
// from --year at run time (pid = `bv-{locationSlug}-{year}`). Multiple classroom
// rows per level in CMT's sheet collapse to one level with the union grade band
// (the schema has no section concept). Proposed-teacher NAMES from the sheet are
// NOT mapped to accounts here (a separate onboarding step); teacherRefs are
// preserved on re-run.
const LOCATIONS: LocationSeed[] = [
  {
    // West/Brampton, 2026-27. NOTE: the sheet lists NO adult class for West, so
    // "Parents" is intentionally omitted here — the existing Brampton Parents
    // level is left untouched (owner decision 2026-07-06). West Level 5/6 were
    // rebanded from 2025-26 (Gr 8–9 / 10) to Gr 8 / Gr 9–10.
    location: 'Brampton',
    levels: [
      { levelName: 'Shishu Vihar', levelKind: 'shishu', gradeBand: [], ageLabel: 'Under 4', curriculum: 'Shishu (All Devatas)' },
      { levelName: 'Pre-Level 1', levelKind: 'pre-level', gradeBand: ['JK', 'SK'], ageLabel: 'JK / SK', curriculum: 'Alphabet Safari' },
      { levelName: 'Level 1', levelKind: 'level', gradeBand: ['1'], ageLabel: 'Grade 1', curriculum: 'Krishna Krishna' },
      { levelName: 'Level 2', levelKind: 'level', gradeBand: ['2', '3'], ageLabel: 'Grade 2 & 3', curriculum: 'Bala Bhagavatam' },
      { levelName: 'Level 3', levelKind: 'level', gradeBand: ['4', '5'], ageLabel: 'Grade 4 & 5', curriculum: '24 Gurus' },
      { levelName: 'Level 4', levelKind: 'level', gradeBand: ['6', '7'], ageLabel: 'Grade 6 & 7', curriculum: 'India, P.O Box God' },
      { levelName: 'Level 5', levelKind: 'level', gradeBand: ['8'], ageLabel: 'Grade 8', curriculum: 'Yato Dharma' },
      { levelName: 'Level 6', levelKind: 'level', gradeBand: ['9', '10'], ageLabel: 'Grade 9 & 10', curriculum: 'Self Unfoldment + 7 Habits' },
      { levelName: 'Level 7', levelKind: 'level', gradeBand: ['11', '12'], ageLabel: 'Grade 11 & 12', curriculum: 'Essence of Gita for Youth (Verses)' },
    ],
  },
  {
    // East/Scarborough, 2026-27. Bands unchanged from 2025-26; curriculum updated;
    // keeps an adult "Parents" level (sheet's "Adult Class").
    location: 'Scarborough',
    levels: [
      { levelName: 'Shishu Vihar', levelKind: 'shishu', gradeBand: [], ageLabel: '1.5 to 3 years', curriculum: 'Devatas' },
      { levelName: 'Pre-Level A', levelKind: 'pre-level', gradeBand: ['JK', 'SK'], ageLabel: 'JK / SK', curriculum: 'Alphabet Safari' },
      { levelName: 'Level A', levelKind: 'level', gradeBand: ['1', '2'], ageLabel: 'Grade 1 & 2', curriculum: 'Bala Ramayana' },
      { levelName: 'Level B', levelKind: 'level', gradeBand: ['3', '4'], ageLabel: 'Grade 3 & 4', curriculum: 'Balabhagavatam' },
      { levelName: 'Level C', levelKind: 'level', gradeBand: ['5', '6'], ageLabel: 'Grade 5 & 6', curriculum: 'Symbolism in Hinduism' },
      { levelName: 'Level D', levelKind: 'level', gradeBand: ['7', '8'], ageLabel: 'Grade 7 & 8', curriculum: 'Hindu Culture' },
      { levelName: 'Level E', levelKind: 'level', gradeBand: ['9', '10', '11', '12'], ageLabel: 'Grade 9 to 12', curriculum: 'Bhagavat Gita' },
      { levelName: 'Parents', levelKind: 'parents', gradeBand: [], ageLabel: 'All Adults', curriculum: 'Adult Class' },
    ],
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!/^\d{4}-\d{2}$/.test(args.year)) {
    console.error(`Invalid --year "${args.year}". Expected YYYY-YY, e.g. 2026-27.`);
    process.exit(1);
  }

  const projectId = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '';
  if (!projectId) {
    console.error('PORTAL_FIREBASE_PROJECT_ID is not set. Is .env.local loaded?');
    process.exit(1);
  }
  const isProd = projectId === 'chinmaya-setu-715b8';
  // --verify is read-only, so it never needs --allow-prod (reconciling prod is safe).
  if (isProd && !args.allowProd && !args.verify) {
    console.error(`Refusing to write to prod (${projectId}) without --allow-prod.`);
    process.exit(1);
  }

  const locations = args.location
    ? LOCATIONS.filter((l) => l.location.toLowerCase() === args.location!.toLowerCase())
    : LOCATIONS;
  if (args.location && locations.length === 0) {
    console.error(`Unknown --location "${args.location}". Expected Brampton or Scarborough.`);
    process.exit(1);
  }

  const db = getFirestore(getPortalApp());

  // Read-only reconciliation: prove a target DB matches the committed sheet defs.
  if (args.verify) {
    console.log(`Verify: ${projectId} | year ${args.year} | locations: ${locations.map((l) => l.location).join(', ')}`);
    const okAll = await verifyLevels(db, locations, args.year);
    console.log(okAll ? '\n✔ All expected levels match the sheet defs.' : '\n✘ Mismatches found (see above).');
    process.exit(okAll ? 0 : 1);
  }

  console.log(
    `Target project: ${projectId} | year ${args.year} | locations: ${locations.map((l) => l.location).join(', ')}` +
      `${args.resetTeachers ? ' | RESET teacherRefs' : ' | preserve teacherRefs'}${args.dryRun ? ' [DRY RUN]' : ''}`,
  );

  const systemUid = 'seed-script';
  const now = Timestamp.now();

  // 1) Delete any explicitly-listed stray docs first (e.g. a bad manual level).
  for (const id of args.deleteIds) {
    const ref = db.collection('levels').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`[delete] ${id} — not found, skipping`);
      continue;
    }
    const d = snap.data() ?? {};
    console.log(`[delete] ${id} — name=${JSON.stringify(d.levelName)} pid=${d.pid} teacherRefs=${JSON.stringify(d.teacherRefs ?? [])}`);
    if (!args.dryRun) {
      await ref.delete();
      console.log(`  ✔ deleted ${id}`);
    }
  }

  // 2) Upsert each location's levels for the target year.
  let count = 0;
  for (const loc of locations) {
    const pid = `bv-${toSafeSlug(loc.location)}-${args.year}`;
    const periodSnap = await db.collection('donationPeriods').doc(pid).get();
    if (!periodSnap.exists) {
      console.warn(`⚠ donationPeriods/${pid} missing — run seed:donation-periods first. Skipping ${loc.location}.`);
      continue;
    }
    const periodLabel = (periodSnap.data()?.periodLabel as string | undefined) ?? args.year;

    for (const [order, lvl] of loc.levels.entries()) {
      count++;
      const levelId = `${toSafeSlug(loc.location)}-${levelSlug(lvl.levelName)}-${pid}`;
      const existing = (await db.collection('levels').doc(levelId).get()).data();
      const teacherRefs = args.resetTeachers ? [] : ((existing?.teacherRefs as string[] | undefined) ?? []);
      const createdAt = (existing?.createdAt as Timestamp | undefined) ?? now;
      const createdBy = (existing?.createdBy as string | undefined) ?? systemUid;

      if (args.dryRun) {
        console.log(`[dry-run] upsert ${levelId} (${lvl.levelName} @ ${loc.location}) teacherRefs=${teacherRefs.length}`);
        continue;
      }
      try {
        await db.collection('levels').doc(levelId).set({
          levelId,
          programKey: 'bala-vihar',
          location: loc.location,
          levelName: lvl.levelName,
          levelKind: lvl.levelKind,
          order,
          gradeBand: lvl.gradeBand,
          ageLabel: lvl.ageLabel,
          curriculum: lvl.curriculum,
          pid,
          periodLabel,
          teacherRefs,
          enabled: true,
          createdAt,
          createdBy,
          updatedAt: now,
          updatedBy: systemUid,
        });
        console.log(`  ✔ upserted ${levelId} (teacherRefs=${teacherRefs.length})`);
      } catch (err) {
        console.error(`  ✘ failed ${levelId}:`, err);
      }
    }
  }
  console.log(`Done. ${count} levels processed${args.deleteIds.length ? `, ${args.deleteIds.length} delete(s) requested` : ''}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
