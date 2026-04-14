import { AdminLoginForm } from '@/features/check-in/auth/admin-login-form';

export const metadata = { title: 'Admin sign in — CMT Portal' };

export default function AdminLoginPage() {
  return (
    <main className="min-h-screen bg-[hsl(var(--muted))]">
      <AdminLoginForm />
    </main>
  );
}
