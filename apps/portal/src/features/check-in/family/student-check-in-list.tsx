'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@cmt/ui';
import type { Student } from '@cmt/shared-domain/check-in';

interface Props {
  students: Student[];
}

export function StudentCheckInList({ students }: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(students.map((student) => [student.sid, true])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function toggle(sid: string) {
    setSelected((prev) => ({ ...prev, [sid]: !prev[sid] }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch('/api/check-in/family/self-check-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ students: selected }),
      });
      if (!res.ok) {
        setError('Check-in failed. Please try again.');
        return;
      }
      globalThis.location.assign('/check-in/family');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {students.map((student) => (
          <li
            key={student.sid}
            className="flex items-center gap-3 rounded border border-[hsl(var(--border))] p-3"
          >
            <input
              id={`student-${student.sid}`}
              type="checkbox"
              checked={selected[student.sid] ?? false}
              onChange={() => toggle(student.sid)}
              className="h-5 w-5"
            />
            <label htmlFor={`student-${student.sid}`} className="flex-1">
              <div className="font-medium">
                {student.firstName} {student.lastName}
              </div>
              <div className="text-sm text-[hsl(var(--foreground))]">
                Level: {student.level}
              </div>
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
        {pending ? 'Checking in...' : 'Check in'}
      </Button>
    </form>
  );
}
