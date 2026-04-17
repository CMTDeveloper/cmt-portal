import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { FamilyLoginForm } from '@/features/check-in/family';

export const metadata = { title: 'Family sign in — CMT Portal' };

export default async function FamilyLoginPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get('__session')?.value;
  if (session) {
    const claims = await verifyPortalSessionCookie(session).catch(() => null);
    if (claims?.role === 'family') redirect('/check-in/family');
  }

  return (
    <main className="min-h-screen bg-[hsl(var(--muted))]">
      <FamilyLoginForm />
    </main>
  );
}
