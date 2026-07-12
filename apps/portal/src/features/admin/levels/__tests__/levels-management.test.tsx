import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

// The detail panel calls these client wrappers; mock the -client module (never
// the server fn) per repo rule. No calls fire on render — declared for safety.
const clientMock = vi.hoisted(() => ({
  searchTeachersClient: vi.fn(),
  addLevelTeacherClient: vi.fn(),
  removeLevelTeacherClient: vi.fn(),
  setLevelLeadTeacherClient: vi.fn(),
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
  it('renders the levels table with read-only teacher pills and an empty detail panel', () => {
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
    // The level and its read-only pills render directly (N=2 teachers).
    expect(screen.getAllByText('Level 1')[0]).toBeTruthy();
    expect(screen.getAllByText('Meera Rao')[0]).toBeTruthy();
    expect(screen.getAllByText('Anil Kumar')[0]).toBeTruthy();
    // Teacher management moved to the panel: no add-teacher control in the row.
    expect(screen.queryByRole('button', { name: /assign teacher/i })).toBeNull();
    // The detail panel prompts for a selection until a level is picked.
    expect(screen.getByText(/select a level/i)).toBeTruthy();
  });

  it('opens the detail panel with an Add teacher control when a level is selected', async () => {
    const user = userEvent.setup();
    render(
      <LevelsManagement
        initialLevels={LEVELS}
        periods={PERIODS}
        programs={PROGRAMS}
        locationOptions={['Brampton']}
        teachersByLevel={TEACHERS_BY_LEVEL}
      />,
    );

    await user.click(screen.getAllByText('Level 1')[0]!);

    // The selected-level panel body is rendered twice in jsdom (the always-on
    // desktop column + the mobile bottom-sheet drawer, both present because CSS
    // `hidden`/`md:hidden` does not unmount). Scope the assertions to the desktop
    // column so they stay unambiguous without weakening what they verify.
    const desktopPanel = within(screen.getByTestId('level-detail-desktop'));
    // Panel now shows the level's teachers with an Add teacher control.
    expect(desktopPanel.getByRole('button', { name: /add teacher/i })).toBeTruthy();
    // Neither teacher is the lead on this fixture, so both read Assistant Teacher.
    expect(desktopPanel.getAllByText('Assistant Teacher')).toHaveLength(2);
  });

  it('opens a mobile bottom-sheet drawer on select and clears the selection when closed', async () => {
    const user = userEvent.setup();
    render(
      <LevelsManagement
        initialLevels={LEVELS}
        periods={PERIODS}
        programs={PROGRAMS}
        locationOptions={['Brampton']}
        teachersByLevel={TEACHERS_BY_LEVEL}
      />,
    );

    // Nothing selected: the mobile drawer is not mounted and the desktop panel
    // shows its empty state.
    expect(screen.queryByTestId('level-detail-mobile')).toBeNull();
    expect(screen.getByText(/select a level/i)).toBeTruthy();

    await user.click(screen.getAllByText('Level 1')[0]!);

    // Selecting mounts the mobile drawer with the same panel body.
    const drawer = screen.getByTestId('level-detail-mobile');
    expect(within(drawer).getByRole('button', { name: /add teacher/i })).toBeTruthy();

    // Closing the drawer clears the selection: the drawer unmounts and the
    // desktop empty state returns.
    await user.click(within(drawer).getByRole('button', { name: /close/i }));

    expect(screen.queryByTestId('level-detail-mobile')).toBeNull();
    expect(screen.getByText(/select a level/i)).toBeTruthy();
  });

  it('disables the "New level" control when readOnly (viewing a past year)', () => {
    render(<LevelsManagement initialLevels={LEVELS} periods={PERIODS} programs={PROGRAMS} locationOptions={['Brampton']} readOnly />);
    expect(screen.getByText('Viewing a past year - read-only.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /new level/i })).toBeDisabled();
  });
});

