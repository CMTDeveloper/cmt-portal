'use client';

import { useState } from 'react';
import {
  LevelsTable,
  type LevelRow,
  type LevelTeacher,
  type PeriodOption,
  type TeacherAssignmentChange,
} from './levels-table';
import type { ProgramRow } from '@/features/admin/programs/programs-table';

interface LevelsManagementProps {
  initialLevels: LevelRow[];
  periods: PeriodOption[];
  programs: ProgramRow[];
  /** levelId → resolved {mid,name} teachers for the inline pills (server-resolved). */
  teachersByLevel?: Record<string, LevelTeacher[]>;
  /** When true (viewing a past school year), mutate controls are disabled. */
  readOnly?: boolean;
}

export function LevelsManagement({
  initialLevels,
  periods,
  programs,
  teachersByLevel,
  readOnly = false,
}: LevelsManagementProps) {
  const [levels, setLevels] = useState(initialLevels);

  // Keep the parent's `levels[].teacherRefs` in sync when a pill is added or
  // removed inline, so the modal/edit flow sees the current teacher set.
  function handleAssignmentSaved(change: TeacherAssignmentChange) {
    setLevels((prev) =>
      prev.map((level) => {
        if (level.levelId !== change.levelId) return level;
        if (change.op === 'add') {
          if (level.teacherRefs.includes(change.mid)) return level;
          return { ...level, teacherRefs: [...level.teacherRefs, change.mid] };
        }
        return { ...level, teacherRefs: level.teacherRefs.filter((ref) => ref !== change.mid) };
      }),
    );
  }

  return (
    <section>
      {readOnly && (
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
          Viewing a past year — read-only.
        </p>
      )}
      <div className="card" style={{ padding: 22 }}>
        <LevelsTable
          initialLevels={levels}
          periods={periods}
          programs={programs}
          teachersByLevel={teachersByLevel ?? {}}
          onLevelsChange={setLevels}
          onAssignmentSaved={handleAssignmentSaved}
          readOnly={readOnly}
        />
      </div>
    </section>
  );
}
