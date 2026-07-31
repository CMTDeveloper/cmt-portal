/**
 * Set `app_config/school_year` — the ACTIVE school year for the whole portal.
 *
 * Why this script exists: the year is normally set by an admin at
 * `/admin/school-year`, but at a first cutover there is no admin yet and the doc
 * is ABSENT — and an absent doc does not fail, it silently falls back to
 * `DEFAULT_FROM_YEAR` ('2025-26', features/setu/rollover/school-year.ts). So a
 * prod seeded for 2026-27 would run its enrollment, roster and prasad lookups
 * against 2025-26 and find nothing, with no error anywhere. This closes that gap
 * before the first family arrives.
 *
 * Read-only unless --set is passed. Refuses a non-UAT project without
 * --allow-prod, like every other ops script here.
 *
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/set-school-year.ts
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/set-school-year.ts --set 2026-27 --allow-prod
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { SchoolYearConfigSchema } from '@cmt/shared-domain';
import { DEFAULT_SCHOOL_YEAR_CONFIG } from '../src/features/setu/rollover/school-year-config';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const project = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '(unset)';
  const allowProd = process.argv.includes('--allow-prod');
  const target = arg('--set');

  if (project !== 'chinmaya-setu-uat' && !allowProd) {
    console.error(`Refusing to touch "${project}" without --allow-prod.`);
    process.exitCode = 1;
    return;
  }

  const db = portalFirestore();
  const ref = db.collection('app_config').doc('school_year');
  const snap = await ref.get();

  console.log(`project: ${project}`);
  if (!snap.exists) {
    console.log(`current: (doc ABSENT) → code falls back to "${DEFAULT_SCHOOL_YEAR_CONFIG.currentYear}"`);
  } else {
    console.log(`current: ${JSON.stringify(snap.data())}`);
  }

  if (!target) {
    console.log('\nRead-only (no --set given). Pass --set YYYY-YY to write.');
    return;
  }

  const parsed = SchoolYearConfigSchema.safeParse({ currentYear: target });
  if (!parsed.success) {
    console.error(`\n"${target}" is not a valid school-year label (expected e.g. 2026-27).`);
    process.exitCode = 1;
    return;
  }

  await ref.set({ currentYear: parsed.data.currentYear, updatedAt: new Date(), updatedBy: 'cutover-script' }, { merge: true });
  const after = await ref.get();
  console.log(`\nwrote: ${JSON.stringify(after.data())}`);
}

void main();
