import Link from 'next/link';
import { ClassListCard } from './class-list-card';

interface Props {
  classes: Array<{ classId: string; name: string; studentCount: number }>;
}

export function TeacherDashboard({ classes }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between">
        <h1 className="text-3xl font-bold text-[hsl(var(--heading))]">Teacher</h1>
        <form action="/api/auth/signout" method="post">
          <button type="submit" className="text-sm underline">
            Sign out
          </button>
        </form>
      </header>

      <nav className="flex gap-4 text-sm">
        <Link href="/check-in/teacher/report" className="underline">
          Attendance report
        </Link>
        <Link href="/check-in/teacher/uninformed" className="underline">
          Uninformed absentees
        </Link>
      </nav>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-[hsl(var(--heading))]">Your classes</h2>
        {classes.length === 0 ? (
          <p className="text-sm text-[hsl(var(--foreground))]">No classes assigned yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {classes.map((c) => (
              <ClassListCard key={c.classId} {...c} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
