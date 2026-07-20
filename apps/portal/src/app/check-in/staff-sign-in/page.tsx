import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { StaffSignInForm } from '@/features/check-in/kiosk/staff-sign-in-form';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Staff sign-in' };

export default function StaffSignInPage() {
  if (!flags.checkInKiosk) notFound();
  // StaffSignInForm uses useSearchParams() — Next 16 requires it inside Suspense
  // (CSR-bailout during prerender of the dynamic ?from=/?error= query).
  return (
    <Suspense fallback={null}>
      <StaffSignInForm />
    </Suspense>
  );
}
