import { redirect } from 'next/navigation';

// Donation periods are now managed per-program under /admin/programs.
// Redirect to the programs hub.
export default function DonationPeriodsPage() {
  redirect('/admin/programs');
}
