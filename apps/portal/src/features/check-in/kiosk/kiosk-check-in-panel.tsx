'use client';
import { useState, type FormEvent } from 'react';
import { Button } from '@cmt/ui';
import type { Family } from '@cmt/shared-domain/check-in';

interface Props {
  family: Family;
  onDone: () => void;
}

export function KioskCheckInPanel({ family, onDone }: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(family.students.map((s) => [s.sid, true])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function toggle(sid: string) {
    setSelected((prev) => ({ ...prev, [sid]: !prev[sid] }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/check-in/families/${family.fid}/check-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ students: selected }),
      });
      if (!res.ok) {
        setError('Check-in failed. Please try again.');
        return;
      }
      onDone();
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-lg border border-[hsl(var(--border))] p-6"
    >
      <header>
        <h2 className="text-2xl font-bold text-[hsl(var(--heading))]">{family.name}</h2>
        <p className="text-sm text-[hsl(var(--foreground))]">
          Family ID: <code>{family.fid}</code>
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {family.students.map((s) => (
          <li
            key={s.sid}
            className="flex items-center gap-3 rounded border border-[hsl(var(--border))] p-3"
          >
            <input
              id={`k-${s.sid}`}
              type="checkbox"
              checked={selected[s.sid] ?? false}
              onChange={() => toggle(s.sid)}
              className="h-5 w-5"
            />
            <label htmlFor={`k-${s.sid}`} className="flex-1">
              <div className="font-medium">
                {s.firstName} {s.lastName}
              </div>
              <div className="text-sm text-[hsl(var(--foreground))]">{s.level}</div>
            </label>
          </li>
        ))}
      </ul>

      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Checking in…' : 'Check in family'}
      </Button>
    </form>
  );
}
