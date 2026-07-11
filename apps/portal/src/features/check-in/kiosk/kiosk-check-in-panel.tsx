'use client';
import { useState, type FormEvent } from 'react';
import { Button } from '@cmt/ui';
import type { Family } from '@cmt/shared-domain/check-in';

interface Props {
  family: Family;
  // Which lookup resolved this family - decides the check-in submit target.
  source: 'setu' | 'legacy';
  // The raw id the sevak entered (publicFid or legacy check-in id). The Setu
  // check-in re-resolves this, NOT `family.fid`.
  checkInId: string;
  onDone: () => void;
}

export function KioskCheckInPanel({ family, source, checkInId, onDone }: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(family.students.map((s) => [s.sid, true])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Set only when the check-in newly created a Bala Vihar enrollment, so the
  // sevak sees that notable moment on a confirmation screen before resetting.
  const [enrolled, setEnrolled] = useState(false);

  function toggle(sid: string) {
    setSelected((prev) => ({ ...prev, [sid]: !prev[sid] }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res =
        source === 'setu'
          ? await fetch('/api/check-in/setu/check-in', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: checkInId, students: selected }),
            })
          : await fetch(`/api/check-in/families/${family.fid}/check-in`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ students: selected }),
            });
      if (!res.ok) {
        setError('Check-in failed. Please try again.');
        return;
      }

      // On the Setu path the check-in may have auto-enrolled the family into the
      // current Bala Vihar offering. Surface that only when it was newly created
      // (`enroll.created === true`); a re-check-in of an already-enrolled family
      // just resets like the legacy path.
      if (source === 'setu') {
        const body = (await res.json().catch(() => null)) as {
          enroll?: { created?: boolean };
        } | null;
        if (body?.enroll?.created === true) {
          setEnrolled(true);
          return;
        }
      }
      onDone();
    } finally {
      setPending(false);
    }
  }

  if (enrolled) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-lg border border-[hsl(var(--border))] p-6 text-center">
        <h2 className="text-2xl font-bold text-[hsl(var(--heading))]">Checked in</h2>
        <p role="status" className="rounded bg-[hsl(var(--muted))] p-3 text-sm text-[hsl(var(--foreground))]">
          Added to Bala Vihar for this year
        </p>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    );
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
