import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

// The inline pills call these client wrappers; mock the -client module (never
// the server fn) per repo rule. No calls fire on render — declared for safety.
const clientMock = vi.hoisted(() => ({
  searchTeachersClient: vi.fn(),
  addLevelTeacherClient: vi.fn(),
  removeLevelTeacherClient: vi.fn(),
}));
vi.mock('../assign-teacher-client', () => clientMock);

import { LevelsManagement } from '../levels-management';
import type { LevelRow, LevelTeacher, PeriodOption } from '../levels-table';
import type { ProgramRow } from '../../programs/programs-table';

const NOW = new Date().toISOString();

const PERIODS: PeriodOption[] = [
  { pid: 'bv-brampton-2025-26', periodLabel: '2025-26', location: 'Brampton' },
];

const PROGRAMS: ProgramRow[] = [
  {
    programKey: 'bala-vihar',
    label: 'Bala Vihar',
    shortDescription: '',
    status: 'active',
    locations: ['Brampton'],
    termType: 'term',
    eligibility: { memberType: 'child' },
    capabilities: {
      usesOfferings: true,
      usesDonation: true,
      usesLevels: true,
      usesCalendar: true,
      attendanceMode: 'teacher',
    },
    displayOrder: 0,
    createdAt: NOW,
    createdBy: 'admin',
    updatedAt: NOW,
    updatedBy: 'admin',
  },
];

const LEVELS: LevelRow[] = [
  {
    levelId: 'brampton-level-1-bv-brampton-2025-26',
    programKey: 'bala-vihar',
    location: 'Brampton',
    levelName: 'Level 1',
    levelKind: 'level',
    order: 1,
    gradeBand: ['1'],
    ageLabel: 'Grade 1',
    curriculum: 'Basics',
    pid: 'bv-brampton-2025-26',
    periodLabel: '2025-26',
    teacherRefs: [],
    enabled: true,
    createdAt: NOW,
    createdBy: 'admin',
    updatedAt: NOW,
    updatedBy: 'admin',
  },
];

const TEACHERS_BY_LEVEL: Record<string, LevelTeacher[]> = {
  [LEVELS[0]!.levelId]: [
    { mid: 'CMT-AAAA1111-01', name: 'Meera Rao' },
    { mid: 'CMT-BBBB2222-01', name: 'Anil Kumar' },
  ],
};

describe('LevelsManagement', () => {
  it('renders the levels table directly with no "Teacher assignments" tab', () => {
    render(
      <LevelsManagement
        initialLevels={LEVELS}
        periods={PERIODS}
        programs={PROGRAMS}
        locationOptions={['Brampton']}
        teachersByLevel={TEACHERS_BY_LEVEL}
      />,
    );

    // The tab strip is gone entirely.
    expect(screen.queryByRole('tab', { name: 'Teacher assignments' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Levels' })).toBeNull();
    // The level and its inline pills render directly (N=2 teachers).
    expect(screen.getAllByText('Level 1')[0]).toBeTruthy();
    expect(screen.getAllByText('Meera Rao')[0]).toBeTruthy();
    expect(screen.getAllByText('Anil Kumar')[0]).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /assign teacher/i })[0]).toBeTruthy();
  });

  it('disables the "New level" control when readOnly (viewing a past year)', () => {
    render(<LevelsManagement initialLevels={LEVELS} periods={PERIODS} programs={PROGRAMS} locationOptions={['Brampton']} readOnly />);
    expect(screen.getByText('Viewing a past year — read-only.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /new level/i })).toBeDisabled();
  });
});

