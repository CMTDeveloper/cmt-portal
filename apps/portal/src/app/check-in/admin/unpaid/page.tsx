import { notFound } from 'next/navigation';
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import { UnpaidFamilyList } from '@/features/check-in/admin/unpaid-family-list';
import { flags } from '@/lib/flags';
import type { Family } from '@cmt/shared-domain/check-in';

export const metadata = { title: 'Unpaid families — CMT Portal' };
export const dynamic = 'force-dynamic';

export default async function AdminUnpaidPage() {
  if (!flags.checkInAdmin) notFound();
  const all = (await readRtdb<Record<string, Family>>('/families')) ?? {};
  const families = Object.values(all).filter((f) => f.paymentStatus !== 'paid');

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Unpaid families</h1>
      <UnpaidFamilyList families={families} />
    </main>
  );
}
