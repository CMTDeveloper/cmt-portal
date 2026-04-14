import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@cmt/ui';

const options = [
  {
    href: '/login/family',
    title: 'Family',
    description: "Sign in with your email or phone to see your family's check-in history.",
  },
  {
    href: '/login/teacher',
    title: 'Teacher',
    description: 'Sign in to mark attendance for your class.',
  },
  {
    href: '/login/admin',
    title: 'Admin',
    description: 'Manage users, guests, and reports.',
  },
];

export function LoginRolePicker() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-3xl font-bold text-[hsl(var(--heading))]">Sign in</h1>
      <p className="text-center text-[hsl(var(--foreground))]">
        Pick the option that matches how you use the portal.
      </p>
      <div className="grid w-full gap-4 sm:grid-cols-3">
        {options.map((o) => (
          <Link key={o.href} href={o.href} className="block focus:outline-none">
            <Card className="h-full transition hover:shadow-md">
              <CardHeader>
                <CardTitle>{o.title}</CardTitle>
                <CardDescription>{o.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
