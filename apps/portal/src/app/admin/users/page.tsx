import { connection } from 'next/server';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { listSevaks } from '@/features/setu/auth/manage-roles';
import { SevakManager } from '@/features/admin/users/sevak-manager';

export const metadata = { title: 'Users & roles — CMT Portal admin' };

export default async function AdminUsersPage() {
  // connection() so Firebase Admin SDK's internal crypto calls don't trip
  // cacheComponents prerender. Same pattern as other admin pages.
  await connection();

  const sevaks = await listSevaks();

  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <Link
          href="/admin"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: 'var(--muted)',
            textDecoration: 'none',
            marginBottom: 12,
          }}
        >
          <SetuIcon.back /> Back to admin
        </Link>
        <p
          style={{
            fontSize: 11,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
          }}
        >
          Admin · Users & roles
        </p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>
          Users &amp; roles
        </h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 680, lineHeight: 1.55 }}>
          Every sevak and their effective roles. Grant or revoke admin &amp; welcome-team;
          teacher status is read-only here (managed at <code>/admin/levels</code>). Granted roles
          apply at the person&apos;s next sign-in.
        </p>
      </header>

      <SevakManager initialSevaks={sevaks} />
    </>
  );
}
