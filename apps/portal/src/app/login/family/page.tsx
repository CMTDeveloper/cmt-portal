import { FamilyLoginForm } from '@/features/check-in/auth/family-login-form';

export const metadata = { title: 'Family sign in — CMT Portal' };

export default function FamilyLoginPage() {
  return (
    <main className="min-h-screen bg-[hsl(var(--muted))]">
      <FamilyLoginForm />
    </main>
  );
}
