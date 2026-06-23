import { connection } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { AdminPrasadScreen } from '@/features/setu/prasad/admin-prasad-screen';
import { getCurrentPrasadPeriods } from '@/features/setu/prasad/current-periods';

export const metadata = { title: 'Prasad rotation — Admin' };

export default async function PrasadPage() {
  // Cache Components: any page reachable under the admin chrome (which touches
  // Firebase Admin in the layout) must `await connection()` before render so the
  // Vercel prerender check doesn't trip on the Admin SDK's internal
  // crypto.randomBytes() — mirrors admin/school-year/page.tsx.
  await connection();
  const periods = await getCurrentPrasadPeriods(portalFirestore());
  return <AdminPrasadScreen periods={periods} />;
}
