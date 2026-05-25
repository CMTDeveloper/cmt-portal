import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { AddWelcomeTeamForm } from '@/features/check-in/admin/add-welcome-team-form';
import { WelcomeTeamList } from '@/features/check-in/admin/welcome-team-list';
import { hasCapability, type ClaimsShape } from '@/lib/auth/role-claims';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Welcome team — CMT Portal admin' };

export default async function AdminWelcomeTeamPage() {
  if (!flags.checkInAdmin) notFound();
  // connection() so Firebase Admin SDK's internal crypto calls don't trip
  // cacheComponents prerender — same pattern as the other admin pages.
  await connection();

  const result = await portalAuth().listUsers(1000);
  const users = result.users
    .filter((u) => hasCapability((u.customClaims as ClaimsShape | undefined) ?? null, 'welcome-team'))
    .map((u) => {
      const claims = (u.customClaims as Record<string, unknown> | undefined) ?? {};
      const claimsEmail = typeof claims.email === 'string' ? claims.email : '';
      return { uid: u.uid, email: u.email ?? claimsEmail };
    })
    .sort((a, b) => a.email.localeCompare(b.email));

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header>
        <Link href="/check-in/admin" className="text-sm underline">← Back to admin</Link>
        <h1 className="mt-2 text-2xl font-bold text-[hsl(var(--heading))]">Welcome team</h1>
        <p className="mt-2 text-sm text-[hsl(var(--foreground))]">
          Welcome-team volunteers can search any family at <code>/welcome</code> but cannot modify
          family records. Used by CMT helpers at the Sunday lobby. Grant access to a volunteer
          by their email — they'll sign in via OTP, no password.
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Grant access</h2>
        <AddWelcomeTeamForm />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Current welcome-team ({users.length})</h2>
        <WelcomeTeamList users={users} />
      </section>
    </main>
  );
}
