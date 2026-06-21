import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { TeacherLoginForm } from '@/features/check-in/auth/teacher-login-form';

export const metadata = { title: 'Teacher sign in' };

export default async function TeacherLoginPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get('__session')?.value;
  if (session) {
    const claims = await verifyPortalSessionCookie(session).catch(() => null);
    if (claims?.role === 'teacher') redirect('/check-in/teacher');
  }

  return (
    <main className="min-h-screen bg-[hsl(var(--muted))]">
      <TeacherLoginForm />
    </main>
  );
}
