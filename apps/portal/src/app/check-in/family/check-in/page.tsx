import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { StudentCheckInList } from '@/features/check-in/family';
import { findFamilyById } from '@/features/check-in/shared';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Check in my kids — CMT Portal' };

export default async function FamilySelfCheckInPage() {
  if (!flags.checkInFamily) notFound();

  const h = await headers();
  const familyId = h.get('x-portal-family-id');
  if (!familyId) notFound();

  const family = await findFamilyById(familyId);
  if (!family) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Check in your kids</h1>
      <p className="text-sm text-[hsl(var(--foreground))]">
        Uncheck any child who is not attending today.
      </p>
      <StudentCheckInList students={family.students} />
    </main>
  );
}
