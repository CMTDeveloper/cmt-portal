import { connection } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { AdminPrasadScreen } from '@/features/setu/prasad/admin-prasad-screen';
import { getPrasadPeriodsForYear } from '@/features/setu/prasad/current-periods';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';
import { listKnownSchoolYears, resolveViewYear } from '@/features/setu/rollover/view-year';

export const metadata = { title: 'Prasad rotation — Admin' };

export default async function PrasadPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  // Cache Components: any page reachable under the admin chrome (which touches
  // Firebase Admin in the layout) must `await connection()` before render so the
  // Vercel prerender check doesn't trip on the Admin SDK's internal
  // crypto.randomBytes() — mirrors admin/school-year/page.tsx.
  await connection();
  const db = portalFirestore();
  const liveYear = await getLiveSchoolYearCached();
  const years = await listKnownSchoolYears(db, liveYear);
  const view = resolveViewYear(years, liveYear, (await searchParams).year ?? null);
  const periods = await getPrasadPeriodsForYear(db, view.year);
  return <AdminPrasadScreen periods={periods} />;
}
