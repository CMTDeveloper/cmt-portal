import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { AdminPledgesScreen } from '@/features/setu/pledges/components/admin-pledges-screen';
import { listPledgesForAdmin } from '@/features/setu/pledges/list-pledges-for-admin';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Monthly pledges — Admin' };

export default async function AdminPledgesPage() {
  // Cache Components: any page under the admin chrome (whose layout touches
  // Firebase Admin) must `await connection()` before render, or the Vercel
  // prerender check trips on the Admin SDK's crypto.randomBytes().
  await connection();
  // 404 rather than an empty screen while the feature is dark - the page should
  // look absent, matching the routes.
  if (!flags.setuPledge) notFound();
  return <AdminPledgesScreen rows={await listPledgesForAdmin()} />;
}
