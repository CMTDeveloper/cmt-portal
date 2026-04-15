'use client';
import { useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';
import type { Family } from '@cmt/shared-domain/check-in';

interface Props {
  onFamily: (family: Family) => void;
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
      const res = await fetch(`/api/check-in/families/${value}`);
      if (res.status === 404) {
        setError('Family not found for this ID.');
        return;
      }
      if (!res.ok) {
        setError('Something went wrong. Try again.');
        return;
      }
      const family = (await res.json()) as Family;
      onFamily(family);
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
