'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';
import { handleKioskAuthExpiry } from './kiosk-auth';

type ContactType = 'email' | 'phone';

interface LookupResult {
  familyId: string;
  publicFid: string | null;
}

export function FamilyLookupForm() {
  const [type, setType] = useState<ContactType>('email');
  const [value, setValue] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Switching the Email/Phone tab starts a fresh lookup: clear the entered value
  // and any prior result/error so stale data from the other tab never lingers.
  function selectType(next: ContactType) {
    if (next === type) return;
    setType(next);
    setValue('');
    setResult(null);
    setError(null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
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
      const body = (await res.json()) as { familyId: string; publicFid?: string | null };
      setResult({ familyId: body.familyId, publicFid: body.publicFid ?? null });
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
          onClick={() => selectType('email')}
          className={`rounded px-3 py-1 text-sm ${type === 'email' ? 'bg-[hsl(var(--primary))] text-white' : ''}`}
        >
          Email
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={type === 'phone'}
          onClick={() => selectType('phone')}
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
        {result &&
          (result.publicFid && result.publicFid !== result.familyId ? (
            // The family has a NEW Family ID: lead with it and mark the legacy id
            // as retiring - matching the check-in kiosk nudge.
            <div className="rounded-lg border-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 p-4 text-center">
              <p className="text-sm font-medium text-[hsl(var(--foreground))]">Your new Family ID</p>
              <p className="my-1 text-4xl font-extrabold tracking-wider text-[hsl(var(--primary))]">
                {result.publicFid}
              </p>
              <p className="text-sm text-[hsl(var(--foreground))]">
                Please start using it - next time enter <strong>{result.publicFid}</strong> instead
                of {result.familyId}.
              </p>
            </div>
          ) : (
            <div className="rounded border-l-4 border-emerald-500 bg-emerald-50 p-3 text-emerald-900">
              Your family ID is <strong>{result.familyId}</strong>
            </div>
          ))}
        <Button type="submit" disabled={pending}>
          {pending ? 'Looking up…' : 'Look up'}
        </Button>
      </form>
    </div>
  );
}
