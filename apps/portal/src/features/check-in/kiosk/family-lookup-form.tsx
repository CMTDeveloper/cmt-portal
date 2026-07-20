'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';
import { handleKioskAuthExpiry } from './kiosk-auth';

type ContactType = 'email' | 'phone';

export function FamilyLookupForm() {
  const [type, setType] = useState<ContactType>('email');
  const [value, setValue] = useState('');
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFamilyId(null);
    startTransition(async () => {
      const res = await fetch('/api/check-in/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, value }),
      });
      if (handleKioskAuthExpiry(res)) return;
      if (res.status === 404) {
        setError('Not found — no family matches this contact.');
        return;
      }
      if (!res.ok) {
        setError('Something went wrong. Try again.');
        return;
      }
      const body = (await res.json()) as { familyId: string };
      setFamilyId(body.familyId);
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <h2 className="text-2xl font-bold text-[hsl(var(--heading))]">Find your family ID</h2>

      <div role="tablist" className="flex gap-2 border-b pb-2">
        <button
          role="tab"
          type="button"
          aria-selected={type === 'email'}
          onClick={() => setType('email')}
          className={`rounded px-3 py-1 text-sm ${type === 'email' ? 'bg-[hsl(var(--primary))] text-white' : ''}`}
        >
          Email
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={type === 'phone'}
          onClick={() => setType('phone')}
          className={`rounded px-3 py-1 text-sm ${type === 'phone' ? 'bg-[hsl(var(--primary))] text-white' : ''}`}
        >
          Phone
        </button>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="contact">{type === 'email' ? 'Email' : 'Phone'}</Label>
          <Input
            id="contact"
            aria-label={type === 'email' ? 'Email' : 'Phone'}
            type={type === 'email' ? 'email' : 'tel'}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        {error && (
          <div role="alert" className="text-sm text-red-600">
            {error}
          </div>
        )}
        {familyId && (
          <div className="rounded border-l-4 border-emerald-500 bg-emerald-50 p-3 text-emerald-900">
            Your family ID is <strong>{familyId}</strong>
          </div>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Looking up…' : 'Look up'}
        </Button>
      </form>
    </div>
  );
}
