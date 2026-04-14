import { TeacherLoginForm } from '@/features/check-in/auth/teacher-login-form';

export const metadata = { title: 'Teacher sign in — CMT Portal' };

export default function TeacherLoginPage() {
  return (
    <main className="min-h-screen bg-[hsl(var(--muted))]">
      <TeacherLoginForm />
    </main>
  );
}
