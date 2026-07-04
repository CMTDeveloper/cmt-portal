'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@cmt/ui';
import { type AttendanceStatus, type ClassRoster } from '@cmt/shared-domain/check-in';

// UI-only: this legacy marker now offers Present/Absent only. The shared
// ATTENDANCE_STATUSES enum (still present/absent/late/uninformed) is unchanged —
// historical late/uninformed records and the /check-in/teacher/uninformed page
// continue to read and display the wider set.
const WRITE_STATUSES = ['present', 'absent'] as const;

interface Props {
  roster: ClassRoster;
  defaultDate?: string;
}

function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function AttendanceMarker({ roster, defaultDate }: Props) {
  const [date] = useState(defaultDate ?? todayYMD());
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>(
    Object.fromEntries(roster.students.map((s) => [s.sid, 'present' as AttendanceStatus])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setStatus(sid: string, status: AttendanceStatus) {
    setStatuses((prev) => ({ ...prev, [sid]: status }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/check-in/teacher/attendance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classId: roster.classId, date, statuses }),
      });
      if (!res.ok) {
        setError('Submit failed. Try again.');
        return;
      }
      window.location.assign(`/check-in/teacher?submitted=${roster.classId}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">{roster.name}</h1>
        <p className="text-sm text-[hsl(var(--foreground))]">Date: {date}</p>
      </header>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">Student</th>
            {WRITE_STATUSES.map((s) => (
              <th key={s} className="p-2 text-center capitalize">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roster.students.map((student) => (
            <tr key={student.sid} className="border-b">
              <td className="p-2">
                {student.firstName} {student.lastName}
              </td>
              {WRITE_STATUSES.map((s) => (
                <td key={s} className="p-2 text-center">
                  <input
                    type="radio"
                    name={`status-${student.sid}`}
                    aria-label={`${s} ${student.firstName}`}
                    checked={statuses[student.sid] === s}
                    onChange={() => setStatus(student.sid, s)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Submitting…' : 'Submit attendance'}
      </Button>
    </form>
  );
}
