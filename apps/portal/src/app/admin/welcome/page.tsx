import { redirect } from 'next/navigation';

// /admin/welcome doesn't exist as a real route — the family search hero is
// at /welcome (welcome-team capability, admin inherits) and the grant page
// is at /admin/welcome-team. This stub catches the muscle-memory URL.
export default function AdminWelcomeRedirect() {
  redirect('/welcome');
}
