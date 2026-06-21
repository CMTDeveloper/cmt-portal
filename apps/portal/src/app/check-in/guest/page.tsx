import { notFound } from 'next/navigation';
import Link from 'next/link';
import { GuestCheckInForm } from '@/features/check-in/kiosk/guest-check-in-form';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Guest check-in' };

export default function GuestCheckInPage() {
  if (!flags.checkInKiosk) notFound();
  return (
    <main className="min-h-screen bg-[hsl(var(--muted))] p-6">
      <div className="mx-auto max-w-md">
        <GuestCheckInForm />
        <div className="mt-6 text-center">
          <Link href="/check-in" className="text-sm underline">
            Back to family check-in
          </Link>
        </div>
      </div>
    </main>
  );
}
