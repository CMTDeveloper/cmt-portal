import { connection } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { BALA_VIHAR } from '@cmt/shared-domain';
import {
  DEFAULT_FROM_YEAR,
  DEFAULT_TO_YEAR,
  BV_SOURCE_OIDS,
  targetOidOf,
} from '@/features/setu/rollover/school-year';
import { RolloverPage, type RolloverPageState } from '@/features/setu/rollover/components/rollover-page';

export const metadata = { title: 'School Year Rollover — Admin' };

export default async function SchoolYearPage() {
  // Cache Components: any page that touches Firebase Admin must `await connection()`
  // before the SDK calls (the Admin SDK calls crypto.randomBytes() internally and
  // the Vercel build fails the prerender check otherwise) — mirrors admin/levels/page.tsx.
  await connection();

  const fromYear = DEFAULT_FROM_YEAR;
  const toYear = DEFAULT_TO_YEAR;
  const sourceOids = [...BV_SOURCE_OIDS];
  const targetOids = sourceOids.map((oid) => targetOidOf(oid, fromYear, toYear));

  const db = portalFirestore();
  // Read-only counts for the page header + Step 1 explainer. Firestore `in`
  // takes up to 10 values — two oids per side, comfortably within the limit.
  const [sourceOfferingsSnap, sourceLevelsSnap, targetLevelsSnap] = await Promise.all([
    db
      .collection('offerings')
      .where('programKey', '==', BALA_VIHAR)
      .where('termLabel', '==', fromYear)
      .get(),
    db.collection('levels').where('pid', 'in', sourceOids).get(),
    db.collection('levels').where('pid', 'in', targetOids).get(),
  ]);

  const state: RolloverPageState = {
    fromYear,
    toYear,
    nextYearReady: targetLevelsSnap.size > 0,
    sourceLevelCount: sourceLevelsSnap.size,
    sourceOfferingCount: sourceOfferingsSnap.size,
    targetLevelCount: targetLevelsSnap.size,
  };

  return <RolloverPage state={state} />;
}
