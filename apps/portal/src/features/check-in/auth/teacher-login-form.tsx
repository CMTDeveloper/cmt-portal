'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';

export function TeacherLoginForm() {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/auth/teacher/signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) {
        setError('Incorrect teacher passphrase');
        return;
      }
      const data = (await res.json()) as { redirectTo: string };
      window.location.assign(data.redirectTo);
    });
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Teacher sign in</h1>
      <p className="text-sm text-[hsl(var(--foreground))]">
        Enter the shared teacher passphrase to mark attendance.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="passphrase">Passphrase</Label>
        <Input
          id="passphrase"
          type="password"
          required
          autoComplete="off"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
      </div>

      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Signing in\u2026' : 'Sign in'}
      </Button>
    </form>
  );
}
