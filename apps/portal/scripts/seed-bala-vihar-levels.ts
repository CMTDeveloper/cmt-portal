/**
 * Slice 4a — Seed Bala Vihar Levels (classes) per location per active period.
 *
 * Loads the 2025-26 curriculum (CMT West/Brampton + East/Scarborough) into
 * levels/ in UAT Firestore, one level doc per (location, level, period).
 * Idempotent — re-runs overwrite via set(). Targets UAT by default; refuses
 * prod unless --allow-prod.
 *
 * gradeBands use the bare-number convention ("2","3") + JK/SK; matching is
 * grade-label-agnostic via normalizeGrade() (handles "Grade 3"/"Gr 3"/"3").
 *
 * Usage:
 *   pnpm --filter @cmt/portal seed:bala-vihar-levels
 *   pnpm --filter @cmt/portal seed:bala-vihar-levels -- --dry-run
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getPortalApp } from '@cmt/firebase-shared/admin/apps';
import { toSafeSlug, levelSlug, type LevelKind } from '@cmt/shared-domain';

function parseArgs(argv: string[]): { dryRun: boolean; allowProd: boolean } {
  return { dryRun: argv.includes('--dry-run'), allowProd: argv.includes('--allow-prod') };
}

interface LevelSeed {
  levelName: string;
  levelKind: LevelKind;
  gradeBand: string[];
  ageLabel: string;
  curriculum: string;
}

// One period per location (must match seed-donation-periods pids).
const PERIODS: Array<{ location: 'Brampton' | 'Scarborough'; pid: string; periodLabel: string; levels: LevelSeed[] }> = [
  {
    location: 'Brampton',
    pid: 'bv-brampton-2025-26',
    periodLabel: '2025-26',
    levels: [
      { levelName: 'Shishu Vihar', levelKind: 'shishu', gradeBand: [], ageLabel: '1.5 to 4 years', curriculum: 'Devatas' },
      { levelName: 'Pre-Level 1', levelKind: 'pre-level', gradeBand: ['JK', 'SK'], ageLabel: 'JK / SK', curriculum: 'Bala Ramayana' },
      { levelName: 'Level 1', levelKind: 'level', gradeBand: ['1'], ageLabel: 'Grade 1', curriculum: 'Krishna Krishna' },
      { levelName: 'Level 2', levelKind: 'level', gradeBand: ['2', '3'], ageLabel: 'Grade 2 & 3', curriculum: 'Hanuman' },
      { levelName: 'Level 3', levelKind: 'level', gradeBand: ['4', '5'], ageLabel: 'Grade 4 & 5', curriculum: 'Symbolism in Hinduism' },
      { levelName: 'Level 4', levelKind: 'level', gradeBand: ['6', '7'], ageLabel: 'Grade 6 & 7', curriculum: 'Vibhishana Gita' },
      { levelName: 'Level 5', levelKind: 'level', gradeBand: ['8', '9'], ageLabel: 'Grade 8 & 9', curriculum: 'Hindu Culture' },
      { levelName: 'Level 6', levelKind: 'level', gradeBand: ['10'], ageLabel: 'Grade 10', curriculum: 'Mahabharata' },
      { levelName: 'Level 7', levelKind: 'level', gradeBand: ['11', '12'], ageLabel: 'Grade 11 & 12', curriculum: 'Essence of Gita for Youth' },
      { levelName: 'Parents', levelKind: 'parents', gradeBand: [], ageLabel: 'All Adults', curriculum: 'Gita' },
    ],
  },
  {
    location: 'Scarborough',
    pid: 'bv-scarborough-2025-26',
    periodLabel: '2025-26',
    levels: [
      { levelName: 'Shishu Vihar', levelKind: 'shishu', gradeBand: [], ageLabel: '1.5 to 4 years', curriculum: 'Devatas' },
      { levelName: 'Pre-Level A', levelKind: 'pre-level', gradeBand: ['JK', 'SK'], ageLabel: 'JK / SK', curriculum: 'Alphabet Safari' },
      { levelName: 'Level A', levelKind: 'level', gradeBand: ['1', '2'], ageLabel: 'Grade 1 & 2', curriculum: 'Hanuman' },
      { levelName: 'Level B', levelKind: 'level', gradeBand: ['3', '4'], ageLabel: 'Grade 3 & 4', curriculum: 'Krishna Krishna' },
      { levelName: 'Level C', levelKind: 'level', gradeBand: ['5', '6'], ageLabel: 'Grade 5 & 6', curriculum: 'India' },
      { levelName: 'Level D', levelKind: 'level', gradeBand: ['7', '8'], ageLabel: 'Grade 7 & 8', curriculum: 'Yatho Dharma' },
      { levelName: 'Level E', levelKind: 'level', gradeBand: ['9', '10', '11', '12'], ageLabel: 'Grade 9 to 12', curriculum: 'Essence of Gita for Youth' },
      { levelName: 'Parents', levelKind: 'parents', gradeBand: [], ageLabel: 'All Adults', curriculum: 'Dharmashastra' },
    ],
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '';
  if (!projectId) {
    console.error('PORTAL_FIREBASE_PROJECT_ID is not set. Is .env.local loaded?');
    process.exit(1);
  }
  const isProd = projectId === 'chinmaya-setu-715b8';
  if (isProd && !args.allowProd) {
    console.error(`Refusing to write to prod (${projectId}) without --allow-prod.`);
    process.exit(1);
  }

  console.log(`Target project: ${projectId}${args.dryRun ? ' [DRY RUN]' : ''}`);
  const db = getFirestore(getPortalApp());
  const systemUid = 'seed-script';
  const now = Timestamp.now();

  let count = 0;
  for (const period of PERIODS) {
    for (const [order, lvl] of period.levels.entries()) {
      count++;
      const levelId = `${toSafeSlug(period.location)}-${levelSlug(lvl.levelName)}-${period.pid}`;
      if (args.dryRun) {
        console.log(`[dry-run] Would upsert ${levelId} (${lvl.levelName} @ ${period.location})`);
        continue;
      }
      try {
        await db.collection('levels').doc(levelId).set({
          levelId,
          programKey: 'bala-vihar',
          location: period.location,
          levelName: lvl.levelName,
          levelKind: lvl.levelKind,
          order,
          gradeBand: lvl.gradeBand,
          ageLabel: lvl.ageLabel,
          curriculum: lvl.curriculum,
          pid: period.pid,
          periodLabel: period.periodLabel,
          teacherRefs: [],
          enabled: true,
          createdAt: now,
          createdBy: systemUid,
          updatedAt: now,
          updatedBy: systemUid,
        });
        console.log(`  ✔ upserted ${levelId}`);
      } catch (err) {
        console.error(`  ✘ failed ${levelId}:`, err);
      }
    }
  }
  console.log(`Done. ${count} levels processed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
