'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';

interface Props {
  onAdded?: (user: { uid: string; email: string }) => void;
}

export function AddWelcomeTeamForm({ onAdded }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const email = String(data.get('email') ?? '').trim();
    if (!email) {
      setError('Enter an email');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/check-in/admin/welcome-team', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Failed to grant');
        return;
      }
      const granted = (await res.json()) as { uid: string; email: string };
      setSuccess(`Granted welcome-team to ${granted.email}. They can now sign in at /sign-in.`);
      form.reset();
      onAdded?.(granted);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="welcome-add-email">Email</Label>
        <Input id="welcome-add-email" name="email" type="email" placeholder="volunteer@example.com" required />
      </div>
      <p className="text-xs text-[hsl(var(--foreground))]">
        The volunteer signs in at <code>/sign-in</code> with this email via OTP. No password needed.
        They'll land on <code>/welcome</code> with read access to every family.
      </p>
      {error && <div role="alert" className="text-sm text-red-600">{error}</div>}
      {success && <div role="status" className="text-sm text-emerald-700">{success}</div>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Granting…' : 'Grant welcome-team'}
      </Button>
    </form>
  );
}
