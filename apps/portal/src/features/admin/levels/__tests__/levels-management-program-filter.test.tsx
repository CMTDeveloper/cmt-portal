import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

// The detail panel calls these client wrappers; mock the -client module (never
// the server fn) per repo rule. No calls fire on render.
const clientMock = vi.hoisted(() => ({
  searchTeachersClient: vi.fn(),
  addLevelTeacherClient: vi.fn(),
  removeLevelTeacherClient: vi.fn(),
  setLevelLeadTeacherClient: vi.fn(),
}));
vi.mock('../assign-teacher-client', () => clientMock);

import { LevelsManagement } from '../levels-management';
import type { LevelRow, PeriodOption } from '../levels-table';
import type { ProgramRow } from '../../programs/programs-table';

const NOW = new Date().toISOString();

function makeLevel(over: Partial<LevelRow> & { levelId: string; levelName: string }): LevelRow {
  return {
    programKey: 'bala-vihar',
    location: 'Brampton',
    levelKind: 'level',
    order: 1,
    gradeBand: ['1'],
    ageLabel: 'Grade 1',
    curriculum: 'Ramayana',
    pid: 'bv-brampton-2025-26',
    periodLabel: '2025-26',
    teacherRefs: [],
    enabled: true,
    createdAt: NOW,
    createdBy: 'admin',
    updatedAt: NOW,
    updatedBy: 'admin',
    ...over,
  };
}

// Two Bala Vihar levels + one Tabla level, all Brampton + enabled, so the program
// filter (not location/showDisabled) is what moves the rows and the stat counts.
const LEVELS: LevelRow[] = [
  makeLevel({ levelId: 'bv-alpha', levelName: 'BV Alpha', programKey: 'bala-vihar' }),
  makeLevel({ levelId: 'bv-beta', levelName: 'BV Beta', programKey: 'bala-vihar' }),
  makeLevel({ levelId: 'tabla-solo', levelName: 'Tabla Solo', programKey: 'tabla' }),
];

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
    capabilities: { usesOfferings: true, usesDonation: true, usesLevels: true, usesCalendar: true, attendanceMode: 'check-in' },
    displayOrder: 0,
    createdAt: NOW,
    createdBy: 'admin',
    updatedAt: NOW,
    updatedBy: 'admin',
  },
  {
    programKey: 'tabla',
    label: 'Tabla',
    shortDescription: '',
    status: 'active',
    locations: [],
    termType: 'term',
    eligibility: { memberType: 'any' },
    capabilities: { usesOfferings: true, usesDonation: false, usesLevels: true, usesCalendar: false, attendanceMode: 'none' },
    displayOrder: 1,
    createdAt: NOW,
    createdBy: 'admin',
    updatedAt: NOW,
    updatedBy: 'admin',
  },
];

function renderManagement() {
  render(
    <LevelsManagement
      locationOptions={['Brampton']}
      initialLevels={LEVELS}
      periods={PERIODS}
      programs={PROGRAMS}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ levelId: 'test-level-id' }),
  }) as unknown as typeof fetch;
});

// The Program selector now lives in LevelsManagement's top filter bar (Location -
// Program - Search - Show disabled), NOT in the LevelsTable toolbar. These tests
// drive that top-bar select and assert it filters rows, stat cards, and the
// "+ New level" modal default.
describe('LevelsManagement - program filter (top filter bar)', () => {
  it('renders a program select in the top filter bar, defaulting to bala-vihar', () => {
    renderManagement();
    const select = screen.getByLabelText(/program/i);
    expect(select).toBeTruthy();
    expect((select as HTMLSelectElement).value).toBe('bala-vihar');
  });

  it('renders an option for each usesLevels program', () => {
    renderManagement();
    expect(screen.getByRole('option', { name: 'Bala Vihar' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Tabla' })).toBeTruthy();
  });

  it('filters both the rows and the stat cards by the selected program', async () => {
    const user = userEvent.setup();
    renderManagement();

    // Default (bala-vihar): the two BV levels show, the Tabla level is hidden.
    expect(screen.getAllByText('BV Alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByText('BV Beta').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Tabla Solo')).toHaveLength(0);
    expect(screen.getByTestId('stat-total')).toHaveTextContent('2');

    // Switch to Tabla: only the Tabla level shows and the stats follow.
    await user.selectOptions(screen.getByLabelText(/program/i), 'tabla');

    expect(screen.getAllByText('Tabla Solo').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('BV Alpha')).toHaveLength(0);
    expect(screen.queryAllByText('BV Beta')).toHaveLength(0);
    expect(screen.getByTestId('stat-total')).toHaveTextContent('1');
  });

  it('uses the selected program as the "+ New level" modal default programKey', async () => {
    const user = userEvent.setup();
    renderManagement();

    await user.selectOptions(screen.getByLabelText(/program/i), 'tabla');
    await user.click(screen.getByText('+ New level'));
    await user.type(screen.getByPlaceholderText('Level 2'), 'Level 1');
    await user.click(screen.getByRole('checkbox', { name: 'Grade 1' }));
    await user.type(screen.getByPlaceholderText('Hanuman'), 'Basics');
    await user.click(screen.getByText('Create level'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const postCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url]) => url === '/api/admin/levels',
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.programKey).toBe('tabla');
  });
});
