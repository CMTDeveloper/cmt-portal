'use client';
import { useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';
import { handleKioskAuthExpiry } from './kiosk-auth';

export function GuestCheckInForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      firstName: String(data.get('firstName') ?? '').trim(),
      lastName: String(data.get('lastName') ?? '').trim(),
      email: String(data.get('email') ?? '').trim() || undefined,
      phone: String(data.get('phone') ?? '').trim() || undefined,
      numberOfAdults: Number(data.get('adults') ?? 1),
      numberOfChildren: Number(data.get('children') ?? 0),
      notes: String(data.get('notes') ?? '').trim() || undefined,
    };
    setPending(true);
    try {
      const res = await fetch('/api/check-in/guests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (handleKioskAuthExpiry(res)) return;
      if (!res.ok) {
        setError('Check-in failed. Try again.');
        return;
      }
      setDone(true);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <h2 className="text-2xl font-bold text-[hsl(var(--heading))]">Thank you!</h2>
        <p className="mt-2 text-[hsl(var(--foreground))]">Your guest check-in has been recorded.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <h2 className="text-2xl font-bold text-[hsl(var(--heading))]">Guest check-in</h2>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" required />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="email">Email (optional)</Label>
        <Input id="email" name="email" type="email" />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input id="phone" name="phone" type="tel" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="adults">Adults</Label>
          <Input id="adults" name="adults" type="number" min="0" defaultValue="1" required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="children">Children</Label>
          <Input id="children" name="children" type="number" min="0" defaultValue="0" required />
        </div>
      </div>

      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Checking in…' : 'Check in as guest'}
      </Button>
    </form>
  );
}
