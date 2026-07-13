import Link from 'next/link';
import type { FamilyDashboardResponse } from '@cmt/shared-domain/check-in';
import { PaymentStatusBanner } from './payment-status-banner';

interface Props {
  data: FamilyDashboardResponse;
}

export function FamilyDashboard({ data }: Props) {
  const { family, recentCheckIns, paymentStatus } = data;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[hsl(var(--heading))]">{family.name}</h1>
          <p className="text-sm text-[hsl(var(--foreground))]">
            Family ID: <code>{family.fid}</code>
          </p>
        </div>
        <form action="/api/auth/signout" method="post">
          <button type="submit" className="text-sm underline">
            Sign out
          </button>
        </form>
      </header>

      <PaymentStatusBanner status={paymentStatus} />

      <section>
        <h2 className="mb-2 text-xl font-semibold text-[hsl(var(--heading))]">Your kids</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {/* family.students now carries the whole family (adults + children) for
              the door kiosk; this "Your kids" list stays child-only. */}
          {family.students.filter((student) => !student.isAdult).map((student) => (
            <li
              key={student.sid}
              className="rounded border border-[hsl(var(--border))] p-3"
            >
              <div className="font-medium">{student.firstName}</div>
              <div className="text-sm text-[hsl(var(--foreground))]">Level: {student.level}</div>
            </li>
          ))}
        </ul>
        <Link
          href="/check-in/family/check-in"
          className="mt-4 inline-block rounded bg-[hsl(var(--primary))] px-4 py-2 text-white hover:opacity-90"
        >
          Check in my kids
        </Link>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-[hsl(var(--heading))]">
          Recent check-ins
        </h2>
        {recentCheckIns.length === 0 ? (
          <p className="text-sm text-[hsl(var(--foreground))]">No check-ins yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {recentCheckIns.map((checkIn) => (
              <li key={checkIn.checkInId} className="flex justify-between gap-4">
                <span>{checkIn.firstName}</span>
                <span className="text-[hsl(var(--foreground))]">
                  {new Date(checkIn.checkedInAt).toLocaleString('en-CA', { timeZone: 'America/Toronto' })} by {checkIn.checkedInBy}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
