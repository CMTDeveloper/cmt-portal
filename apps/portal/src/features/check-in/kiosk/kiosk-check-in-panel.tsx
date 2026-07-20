'use client';
import { useState, type FormEvent } from 'react';
import { Button } from '@cmt/ui';
import type { Family } from '@cmt/shared-domain/check-in';
import { handleKioskAuthExpiry } from './kiosk-auth';

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
      if (handleKioskAuthExpiry(res)) return;
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

  // After the legacy-first resolve, `family.fid` carries the family's NEW
  // publicFid, while `checkInId` is what they typed at the door (their legacy
  // check-in id - the new ids are not distributed yet). When they differ, the
  // family used their OLD id, so nudge them to start using the new one. Only on
  // the Setu path (legacy-lookup families have no new id to show).
  const showNewId = source === 'setu' && Boolean(family.fid) && checkInId !== family.fid;
  const newIdBanner = showNewId ? (
    <div className="rounded-lg border-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 p-4 text-center">
      <p className="text-sm font-medium text-[hsl(var(--foreground))]">
        We are switching to new Family IDs
      </p>
      <p className="my-1 text-4xl font-extrabold tracking-wider text-[hsl(var(--primary))]">
        {family.fid}
      </p>
      <p className="text-sm text-[hsl(var(--foreground))]">
        This is your family&apos;s new Family ID. Please start using it - next time enter{' '}
        <strong>{family.fid}</strong> instead of {checkInId}.
      </p>
    </div>
  ) : null;

  if (enrolled) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-lg border border-[hsl(var(--border))] p-6 text-center">
        <h2 className="text-2xl font-bold text-[hsl(var(--heading))]">Checked in</h2>
        {newIdBanner}
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

      {newIdBanner}

      <div>
        <h3 className="text-lg font-semibold text-[hsl(var(--heading))]">Family members</h3>
        <p className="mt-1 text-sm text-[hsl(var(--primary))]">
          Please tap a member to mark them as not present today.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {family.students.map((s) => {
          const isChecked = selected[s.sid] ?? false;
          const sublabel = s.isAdult ? 'Adult' : s.level;
          return (
            <li key={s.sid}>
              {/* The whole row is a <label> so tapping anywhere toggles the box -
                  matches the legacy family-check-in app and works well at a
                  touch kiosk. */}
              <label
                htmlFor={`k-${s.sid}`}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-4 transition-colors hover:bg-[hsl(var(--accent))]"
              >
                <input
                  id={`k-${s.sid}`}
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(s.sid)}
                  className="h-5 w-5 shrink-0"
                />
                <span className="min-w-0 flex-1 select-none">
                  <span className="block font-semibold text-[hsl(var(--heading))]">
                    {s.firstName} {s.lastName}
                  </span>
                  {sublabel && (
                    <span className="text-sm text-[hsl(var(--foreground))]">{sublabel}</span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
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
