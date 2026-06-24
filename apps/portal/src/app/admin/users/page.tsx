import { connection } from 'next/server';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { listSevaks } from '@/features/setu/auth/manage-roles';
import { SevakManager, type SelfIdentity } from '@/features/admin/users/sevak-manager';

export const metadata = { title: 'Users & roles' };

export default async function AdminUsersPage() {
  // connection() so Firebase Admin SDK's internal crypto calls don't trip
  // cacheComponents prerender. Same pattern as other admin pages.
  await connection();

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  const claims = (sessionCookie ? await verifyPortalSessionCookie(sessionCookie).catch(() => null) : null) as
    | { uid?: string | null; mid?: string | null; email?: string | null }
    | null;
  // Who's viewing — so the matching row can show a "You" badge and the UI can
  // lean on the existing self-lockout guard rather than surprise the admin.
  const self: SelfIdentity = {
    mid: claims?.mid ?? null,
    uid: claims?.uid ?? null,
    contact: claims?.email ?? '',
  };

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
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 12, maxWidth: 720, lineHeight: 1.6 }}>
          Every sevak and their effective roles. Click a row to review access, or use{' '}
          <strong>Edit roles</strong> to change a person&apos;s admin &amp; welcome-team grants, then{' '}
          <strong>Save changes</strong> — roles never change from a single click. Teacher status is
          read-only here (managed at <code>/admin/levels</code>). Saved roles apply at the person&apos;s
          next sign-in.
        </p>
      </header>

      <SevakManager initialSevaks={sevaks} self={self} />
    </>
  );
}
