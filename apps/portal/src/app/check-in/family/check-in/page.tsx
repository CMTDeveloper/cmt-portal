import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { StudentCheckInList } from '@/features/check-in/family';
import { findFamilyById } from '@/features/check-in/shared';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Check in my kids' };

export default async function FamilySelfCheckInPage() {
  if (!flags.checkInFamily) notFound();

  const h = await headers();
  const familyId = h.get('x-portal-family-id');
  if (!familyId) notFound();

  const family = await findFamilyById(familyId);
  if (!family) notFound();

  // findFamilyById now returns the WHOLE family (adults + children) for the
  // door kiosk. This screen is child-focused ("check in your kids"), so show
  // children only. The door kiosk (/check-in) is where the whole family checks in.
  const children = family.students.filter((s) => !s.isAdult);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Check in your kids</h1>
      <p className="text-sm text-[hsl(var(--foreground))]">
        Uncheck any child who is not attending today.
      </p>
      <StudentCheckInList students={children} />
    </main>
  );
}
