import { headers } from 'next/headers';

export const metadata = { title: 'Admin — Check-in — CMT Portal' };
export const dynamic = 'force-dynamic';

export default async function AdminStubPage() {
  const h = await headers();
  const role = h.get('x-portal-role') ?? 'unknown';
  const uid = h.get('x-portal-uid') ?? 'unknown';

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold text-[hsl(var(--heading))]">Admin dashboard</h1>
      <p className="text-[hsl(var(--foreground))]">
        You are signed in as <strong>{role}</strong> (<code>{uid}</code>).
      </p>
      <p className="text-[hsl(var(--foreground))]">
        The full admin dashboard — stats, user provisioning, guest list, reports — is shipping in
        slice B4. This stub confirms the auth gate works.
      </p>
      <form action="/api/auth/signout" method="post">
        <button
          type="submit"
          className="rounded bg-[hsl(var(--primary))] px-4 py-2 text-white hover:opacity-90"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
