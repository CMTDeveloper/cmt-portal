import { connection } from 'next/server';
import { AdminPrasadScreen } from '@/features/setu/prasad/admin-prasad-screen';

export const metadata = { title: 'Prasad rotation — Admin' };

export default async function PrasadPage() {
  // Cache Components: any page reachable under the admin chrome (which touches
  // Firebase Admin in the layout) must `await connection()` before render so the
  // Vercel prerender check doesn't trip on the Admin SDK's internal
  // crypto.randomBytes() — mirrors admin/school-year/page.tsx. The screen itself
  // fetches client-side, so there is no server data load here.
  await connection();
  return <AdminPrasadScreen />;
}
