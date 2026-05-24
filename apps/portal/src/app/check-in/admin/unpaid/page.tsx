import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { UnpaidFamilyList } from '@/features/check-in/admin/unpaid-family-list';
import { listAllFamilies } from '@/features/check-in/shared';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Unpaid families — CMT Portal' };

export default async function AdminUnpaidPage() {
  if (!flags.checkInAdmin) notFound();
  // connection() marks the page dynamic so Firebase Admin SDK's internal
  // crypto.randomBytes() call doesn't trip the cacheComponents prerender check.
  await connection();
  const all = await listAllFamilies();
  const families = all.filter((f) => f.paymentStatus !== 'paid');

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Unpaid families</h1>
      <UnpaidFamilyList families={families} />
    </main>
  );
}
