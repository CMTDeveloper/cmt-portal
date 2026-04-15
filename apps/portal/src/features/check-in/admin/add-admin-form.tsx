'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';

export function AddAdminForm() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      email: String(data.get('email') ?? '').trim(),
      password: String(data.get('password') ?? ''),
    };
    startTransition(async () => {
      const res = await fetch('/api/check-in/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError('Failed to create admin');
        return;
      }
      setSuccess(`Admin ${payload.email} created. Refresh to see them in the list.`);
      form.reset();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="add-email">Email</Label>
        <Input id="add-email" name="email" type="email" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="add-password">Temporary password</Label>
        <Input id="add-password" name="password" type="password" minLength={8} required />
      </div>
      {error && <div role="alert" className="text-sm text-red-600">{error}</div>}
      {success && <div role="status" className="text-sm text-emerald-700">{success}</div>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Add admin'}
      </Button>
    </form>
  );
}
