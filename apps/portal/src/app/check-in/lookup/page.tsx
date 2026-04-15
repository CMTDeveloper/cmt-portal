import { notFound } from 'next/navigation';
import Link from 'next/link';
import { FamilyLookupForm } from '@/features/check-in/kiosk/family-lookup-form';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Find your family ID — CMT Portal' };

export default function LookupPage() {
  if (!flags.checkInKiosk) notFound();
  return (
    <main className="min-h-screen bg-[hsl(var(--muted))] p-6">
      <div className="mx-auto max-w-md">
        <FamilyLookupForm />
        <div className="mt-6 text-center">
          <Link href="/check-in" className="text-sm underline">
            Back to family check-in
          </Link>
        </div>
      </div>
    </main>
  );
}
