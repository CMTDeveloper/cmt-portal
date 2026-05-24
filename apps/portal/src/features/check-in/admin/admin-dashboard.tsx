import Link from 'next/link';
import { StatCard } from './stat-card';

interface Stats {
  checkInsToday: number;
  checkInsThisWeek: number;
  guestsToday: number;
  unpaidFamilies: number;
}

interface Props {
  stats: Stats;
}

export function AdminDashboard({ stats }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between">
        <h1 className="text-3xl font-bold text-[hsl(var(--heading))]">Admin</h1>
        <form action="/api/auth/signout" method="post">
          <button type="submit" className="text-sm underline">
            Sign out
          </button>
        </form>
      </header>

      <nav className="flex flex-wrap gap-4 text-sm">
        <Link href="/check-in/admin/users" className="underline">
          Users
        </Link>
        <Link href="/check-in/admin/guests" className="underline">
          Guests
        </Link>
        <Link href="/check-in/admin/unpaid" className="underline">
          Unpaid families
        </Link>
        <Link href="/check-in/admin/reports" className="underline">
          Reports
        </Link>
        <Link href="/check-in/admin/welcome-team" className="underline">
          Welcome team
        </Link>
      </nav>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Check-ins today" value={stats.checkInsToday} />
        <StatCard title="Check-ins this week" value={stats.checkInsThisWeek} hint="Last 7 days" />
        <StatCard title="Guests today" value={stats.guestsToday} />
        <StatCard title="Unpaid families" value={stats.unpaidFamilies} />
      </section>
    </main>
  );
}
