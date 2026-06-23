import { connection } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import {
  balaViharSourceOidsForYear,
  deriveNextSchoolYear,
  targetOidOf,
} from '@/features/setu/rollover/school-year';
import {
  getSchoolYearConfig,
  listBalaViharSourceOids,
} from '@/features/setu/rollover/school-year-config';
import { computeYearReadiness } from '@/features/setu/rollover/year-readiness';
import { RolloverPage, type RolloverPageState } from '@/features/setu/rollover/components/rollover-page';

export const metadata = { title: 'School Year Rollover — Admin' };

export default async function SchoolYearPage() {
  // Cache Components: any page that touches Firebase Admin must `await connection()`
  // before the SDK calls (the Admin SDK calls crypto.randomBytes() internally and
  // the Vercel build fails the prerender check otherwise) — mirrors admin/levels/page.tsx.
  await connection();

  const db = portalFirestore();
  const schoolYearConfig = await getSchoolYearConfig(db);
  const fromYear = schoolYearConfig.currentYear;
  const toYear = deriveNextSchoolYear(fromYear);
  const configuredSourceOids = await listBalaViharSourceOids(db, fromYear);
  const sourceOids = configuredSourceOids.length > 0
    ? configuredSourceOids
    : balaViharSourceOidsForYear(fromYear);
  const targetOids = sourceOids.map((oid) => targetOidOf(oid, fromYear, toYear));

  // Read-only counts for the page header + Step 1 explainer. Firestore `in`
  // takes up to 10 values — two oids per side, comfortably within the limit.
  // Step 3's per-item readiness is computed alongside (index-safe queries).
  const [sourceLevelsSnap, targetLevelsSnap, readiness] = await Promise.all([
    db.collection('levels').where('pid', 'in', sourceOids).get(),
    db.collection('levels').where('pid', 'in', targetOids).get(),
    computeYearReadiness(db, { fromYear, toYear }),
  ]);

  const state: RolloverPageState = {
    fromYear,
    toYear,
    nextYearReady: targetLevelsSnap.size > 0,
    sourceLevelCount: sourceLevelsSnap.size,
    sourceOfferingCount: configuredSourceOids.length,
    targetLevelCount: targetLevelsSnap.size,
    readiness,
  };

  return <RolloverPage state={state} />;
}
