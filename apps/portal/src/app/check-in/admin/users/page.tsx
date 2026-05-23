import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { AdminUserList } from '@/features/check-in/admin/admin-user-list';
import { AddAdminForm } from '@/features/check-in/admin/add-admin-form';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Admin users — CMT Portal' };

export default async function AdminUsersPage() {
  if (!flags.checkInAdmin) notFound();

  const h = await headers();
  const currentUid = h.get('x-portal-uid') ?? '';

  const result = await portalAuth().listUsers(1000);
  const users = result.users
    .filter((u) => (u.customClaims as { role?: string } | undefined)?.role === 'admin')
    .map((u) => ({ uid: u.uid, email: u.email ?? '' }));

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Admin users</h1>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Add admin</h2>
        <AddAdminForm />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Current admins</h2>
        <AdminUserList users={users} currentUid={currentUid} />
      </section>
    </main>
  );
}
