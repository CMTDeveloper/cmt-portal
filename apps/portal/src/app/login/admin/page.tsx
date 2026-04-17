import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { AdminLoginForm } from '@/features/check-in/auth/admin-login-form';

export const metadata = { title: 'Admin sign in — CMT Portal' };

export default async function AdminLoginPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get('__session')?.value;
  if (session) {
    const claims = await verifyPortalSessionCookie(session).catch(() => null);
    if (claims?.role === 'admin') redirect('/check-in/admin');
  }

  return (
    <main className="min-h-screen bg-[hsl(var(--muted))]">
      <AdminLoginForm />
    </main>
  );
}
