'use client';
import { useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';
import type { Family } from '@cmt/shared-domain/check-in';

interface Props {
  onFamily: (family: Family, source: 'setu' | 'legacy', checkInId: string) => void;
}

export function FamilyIdLookupForm({ onFamily }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!/^\d+$/.test(value)) {
      setError('Please enter a valid number.');
      return;
    }
    setPending(true);
    try {
      // Try the Setu path first (migrated families). Only a 404 - the family is
      // not in Setu yet - falls through to the legacy roster lookup; any other
      // Setu failure is a real error, not a "try legacy" signal.
      const setuRes = await fetch(`/api/check-in/setu/lookup?id=${value}`);
      if (setuRes.ok) {
        const family = (await setuRes.json()) as Family;
        onFamily(family, 'setu', value);
        return;
      }
      if (setuRes.status !== 404) {
        setError('Something went wrong. Try again.');
        return;
      }

      // Legacy fallback for families not yet migrated into Setu.
      const legacyRes = await fetch(`/api/check-in/families/${value}`);
      if (legacyRes.status === 404) {
        setError('Family not found for this ID.');
        return;
      }
      if (!legacyRes.ok) {
        setError('Something went wrong. Try again.');
        return;
      }
      const family = (await legacyRes.json()) as Family;
      onFamily(family, 'legacy', value);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="family-id">Family ID</Label>
        <Input
          id="family-id"
          type="text"
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Finding…' : 'Find family'}
      </Button>
    </form>
  );
}
