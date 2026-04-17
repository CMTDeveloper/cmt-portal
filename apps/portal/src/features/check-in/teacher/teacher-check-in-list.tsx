'use client';
import { useState, useTransition } from 'react';
import type { StudentWithContact } from '@/features/check-in/shared';

interface Props {
  students: StudentWithContact[];
  classId: string;
  date: string;
  initialCheckedSids: string[];
}

export function TeacherCheckInList({ students, classId, date, initialCheckedSids }: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set(initialCheckedSids));
  const [, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const paidStudents = students.filter((s) => s.paymentStatus === 'paid');
  const unpaidStudents = students.filter((s) => s.paymentStatus !== 'paid');
  const checkedInCount = checked.size;

  function toggle(sid: string, currentlyChecked: boolean) {
    const newStatus = !currentlyChecked;
    setChecked((prev) => {
      const next = new Set(prev);
      if (newStatus) next.add(sid);
      else next.delete(sid);
      return next;
    });

    startTransition(async () => {
      const statuses: Record<string, string> = { [sid]: newStatus ? 'present' : 'absent' };
      const res = await fetch('/api/check-in/teacher/attendance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classId, date, statuses }),
      });
      if (!res.ok) {
        // revert on error
        setChecked((prev) => {
          const next = new Set(prev);
          if (newStatus) next.delete(sid);
          else next.add(sid);
          return next;
        });
        setErrors((prev) => ({ ...prev, [sid]: 'Failed to update' }));
      } else {
        setErrors((prev) => {
          const next = { ...prev };
          delete next[sid];
          return next;
        });
      }
    });
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      {/* Stats row */}
      <div className="mt-1 mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg bg-green-50 p-3">
          <div className="text-sm text-gray-500">Registered</div>
          <div className="text-xl md:text-2xl font-bold text-green-600">{paidStudents.length}</div>
        </div>
        <div className="rounded-lg bg-yellow-50 p-3">
          <div className="text-sm text-gray-500">Unregistered</div>
          <div className="text-xl md:text-2xl font-bold text-yellow-600">{unpaidStudents.length}</div>
        </div>
        <div className="rounded-lg bg-blue-50 p-3">
          <div className="text-sm text-gray-500">Checked In</div>
          <div className="text-xl md:text-2xl font-bold text-blue-600">{checkedInCount}</div>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="text-sm text-gray-500">Total</div>
          <div className="text-xl md:text-2xl font-bold text-gray-600">{students.length}</div>
        </div>
      </div>

      {/* Registered students */}
      {paidStudents.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0 w-2 h-2 bg-green-500 rounded-full mr-2" />
            <h3 className="text-lg font-medium text-gray-900">Registered Students</h3>
          </div>
          <div className="space-y-2">
            {paidStudents.map((student) => (
              <StudentCard
                key={student.sid}
                student={student}
                isChecked={checked.has(student.sid)}
                onToggle={toggle}
                error={errors[student.sid]}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unregistered students */}
      {unpaidStudents.length > 0 && (
        <div>
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0 w-2 h-2 bg-yellow-500 rounded-full mr-2" />
            <h3 className="text-lg font-medium text-gray-900">Unregistered Students</h3>
          </div>
          <div className="space-y-2">
            {unpaidStudents.map((student) => (
              <StudentCard
                key={student.sid}
                student={student}
                isChecked={checked.has(student.sid)}
                onToggle={toggle}
                error={errors[student.sid]}
                unregistered
              />
            ))}
          </div>
        </div>
      )}

      {students.length === 0 && (
        <p className="text-sm text-gray-500">No students found for this class.</p>
      )}
    </div>
  );
}

interface CardProps {
  student: StudentWithContact;
  isChecked: boolean;
  onToggle: (sid: string, currentlyChecked: boolean) => void;
  error?: string | undefined;
  unregistered?: boolean | undefined;
}

function StudentCard({ student, isChecked, onToggle, error, unregistered }: CardProps) {
  return (
    <div
      onClick={() => onToggle(student.sid, isChecked)}
      className={[
        'group flex items-center p-3 rounded-lg cursor-pointer',
        'transition-colors duration-200 ease-in-out',
        'hover:bg-gray-50 active:bg-gray-100',
        isChecked ? 'bg-green-50' : 'bg-white',
        'border border-gray-200 shadow-sm',
        unregistered ? 'border-l-4 border-l-yellow-500' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onToggle(student.sid, isChecked);
      }}
    >
      <div className="flex-1">
        <p className="font-medium text-gray-900">
          {student.firstName} {student.lastName}
        </p>
        {student.parentEmail && (
          <p className="text-sm text-gray-500">{student.parentEmail}</p>
        )}
        {student.parentPhone && (
          <p className="text-sm text-gray-500">{student.parentPhone}</p>
        )}
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
      <input
        type="checkbox"
        checked={isChecked}
        onChange={() => onToggle(student.sid, isChecked)}
        onClick={(e) => e.stopPropagation()}
        className="w-6 h-6 rounded-md border-2 border-gray-300 checked:bg-green-500 checked:border-green-500 focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        aria-label={`Mark ${student.firstName} as ${isChecked ? 'absent' : 'present'}`}
      />
    </div>
  );
}
