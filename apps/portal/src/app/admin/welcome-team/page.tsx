import { connection } from 'next/server';
import Link from 'next/link';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { SetuIcon } from '@cmt/ui';
import { ThemedAddWelcomeTeamForm } from '@/features/admin/welcome-team/themed-add-form';
import { ThemedWelcomeTeamList } from '@/features/admin/welcome-team/themed-list';

export const metadata = { title: 'Welcome team — CMT Portal admin' };

export default async function AdminWelcomeTeamPage() {
  // connection() so Firebase Admin SDK's internal crypto calls don't trip
  // cacheComponents prerender. Same pattern as other admin pages.
  await connection();

  const result = await portalAuth().listUsers(1000);
  const users = result.users
    .filter((u) => ((u.customClaims as Record<string, unknown> | undefined) ?? {}).role === 'welcome-team')
    .map((u) => {
      const claims = (u.customClaims as Record<string, unknown> | undefined) ?? {};
      const claimsEmail = typeof claims.email === 'string' ? claims.email : '';
      return { uid: u.uid, email: u.email ?? claimsEmail };
    })
    .sort((a, b) => a.email.localeCompare(b.email));

  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <Link href="/admin" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}>
          <SetuIcon.back/> Back to admin
        </Link>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Admin · Welcome team</p>
        <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>Welcome team grants</h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 640, lineHeight: 1.55 }}>
          Welcome-team volunteers can search any family at <code>/welcome</code> but cannot modify
          family records. Granted by admins. Volunteers sign in via OTP (no password).
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 28, alignItems: 'start' }}>
        {/* Grant form (left) */}
        <section className="card" style={{ padding: 22 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.12em' }}>Grant access</h2>
          <ThemedAddWelcomeTeamForm/>
        </section>

        {/* Current list (right) */}
        <section>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--body-text)' }}>
            Current welcome-team ({users.length})
          </h2>
          <ThemedWelcomeTeamList users={users}/>
        </section>
      </div>
    </>
  );
}
