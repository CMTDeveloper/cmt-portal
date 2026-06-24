'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { AssignTeacherForm } from './assign-teacher-form';
import { LevelsTable, type LevelRow, type PeriodOption } from './levels-table';
import type { ProgramRow } from '@/features/admin/programs/programs-table';

interface LevelsManagementProps {
  initialLevels: LevelRow[];
  periods: PeriodOption[];
  programs: ProgramRow[];
  /** When true (viewing a past school year), mutate controls are disabled. */
  readOnly?: boolean;
}

type Tab = 'levels' | 'teachers';

export function LevelsManagement({ initialLevels, periods, programs, readOnly = false }: LevelsManagementProps) {
  const [levels, setLevels] = useState(initialLevels);
  const [tab, setTab] = useState<Tab>('levels');

  function handleAssignmentSaved(change: { ref: string; added: string[]; removed: string[] }) {
    setLevels((prev) =>
      prev.map((level) => {
        if (change.added.includes(level.levelId) && !level.teacherRefs.includes(change.ref)) {
          return { ...level, teacherRefs: [...level.teacherRefs, change.ref] };
        }
        if (change.removed.includes(level.levelId)) {
          return { ...level, teacherRefs: level.teacherRefs.filter((ref) => ref !== change.ref) };
        }
        return level;
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
      <div
        role="tablist"
        aria-label="Level management sections"
        style={{
          display: 'inline-flex',
          gap: 4,
          padding: 4,
          border: '1px solid var(--line)',
          borderRadius: 'var(--radiusSm)',
          background: 'var(--surface)',
          marginBottom: 16,
        }}
      >
        <TabButton
          id="levels-management-levels-tab"
          controls="levels-management-levels-panel"
          active={tab === 'levels'}
          onClick={() => setTab('levels')}
        >
          Levels
        </TabButton>
        <TabButton
          id="levels-management-teachers-tab"
          controls="levels-management-teachers-panel"
          active={tab === 'teachers'}
          onClick={() => setTab('teachers')}
        >
          Teacher assignments
        </TabButton>
      </div>

      {tab === 'levels' ? (
        <div
          id="levels-management-levels-panel"
          role="tabpanel"
          aria-labelledby="levels-management-levels-tab"
          className="card"
          style={{ padding: 22 }}
        >
          <LevelsTable
            initialLevels={levels}
            periods={periods}
            programs={programs}
            onLevelsChange={setLevels}
            readOnly={readOnly}
          />
        </div>
      ) : (
        <div
          id="levels-management-teachers-panel"
          role="tabpanel"
          aria-labelledby="levels-management-teachers-tab"
          className="card"
          style={{ padding: 22 }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Assign a teacher</h2>
          <AssignTeacherForm levels={levels} onAssignmentSaved={handleAssignmentSaved} readOnly={readOnly} />
        </div>
      )}
    </section>
  );
}

function TabButton({
  id,
  controls,
  active,
  onClick,
  children,
}: {
  id: string;
  controls: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      style={{
        minHeight: 34,
        padding: '7px 14px',
        border: 0,
        borderRadius: 'var(--radiusSm)',
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'var(--body-text)',
        fontSize: 13,
        fontWeight: 700,
        fontFamily: 'var(--body)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}
