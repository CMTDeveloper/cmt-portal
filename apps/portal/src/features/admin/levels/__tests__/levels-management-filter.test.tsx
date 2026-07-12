import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

// The inline teacher pills call these client wrappers; mock the -client module
// (never the server fn) per repo rule. No calls fire during the filter tests.
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

// Realistic multi-instance fixture: >=2 Brampton (incl. 1 disabled + 1 with no
// teachers) and >=1 Scarborough.
const LEVELS: LevelRow[] = [
  makeLevel({ levelId: 'brampton-alpha', levelName: 'Brampton Alpha', teacherRefs: ['CMT-A-01'] }),
  makeLevel({ levelId: 'brampton-beta', levelName: 'Brampton Beta', teacherRefs: ['CMT-B-01'], enabled: false }),
  makeLevel({ levelId: 'brampton-gamma', levelName: 'Brampton Gamma', teacherRefs: [] }),
  makeLevel({ levelId: 'scarborough-delta', levelName: 'Scarborough Delta', location: 'Scarborough', teacherRefs: ['CMT-D-01'] }),
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
    locations: ['Brampton', 'Scarborough'],
    termType: 'term',
    eligibility: { memberType: 'child' },
    capabilities: { usesOfferings: true, usesDonation: true, usesLevels: true, usesCalendar: true, attendanceMode: 'teacher' },
    displayOrder: 0,
    createdAt: NOW,
    createdBy: 'admin',
    updatedAt: NOW,
    updatedBy: 'admin',
  },
];

const TEACHERS_BY_LEVEL: Record<string, LevelTeacher[]> = {
  'brampton-alpha': [{ mid: 'CMT-A-01', name: 'Asha Rao' }],
  'brampton-beta': [{ mid: 'CMT-B-01', name: 'Bina Shah' }],
  'scarborough-delta': [{ mid: 'CMT-D-01', name: 'Deepa Nair' }],
};

function renderManagement() {
  render(
    <LevelsManagement
      locationOptions={['Brampton', 'Scarborough']}
      initialLevels={LEVELS}
      periods={PERIODS}
      programs={PROGRAMS}
      teachersByLevel={TEACHERS_BY_LEVEL}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
});

describe('LevelsManagement - always-one location filter + stat cards', () => {
  it('defaults to the first centre and shows only its enabled levels', () => {
    renderManagement();

    // The segmented control shows Brampton active, Scarborough inactive.
    expect(screen.getByRole('tab', { name: 'Brampton' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Scarborough' })).toHaveAttribute('aria-selected', 'false');

    // Only Brampton enabled levels are listed; the disabled one and Scarborough are hidden.
    expect(screen.getAllByText('Brampton Alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Brampton Gamma').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Brampton Beta')).toHaveLength(0);
    expect(screen.queryAllByText('Scarborough Delta')).toHaveLength(0);

    // Stat cards reflect the Brampton (enabled) list: 2 total, 1 with, 1 needing.
    expect(screen.getByTestId('stat-total')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-with-teachers')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-needing-teachers')).toHaveTextContent('1');
  });

  it('swaps the list and stats to Scarborough when its segment is clicked', async () => {
    const user = userEvent.setup();
    renderManagement();

    await user.click(screen.getByRole('tab', { name: 'Scarborough' }));

    expect(screen.getByRole('tab', { name: 'Scarborough' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('Scarborough Delta').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Brampton Alpha')).toHaveLength(0);
    expect(screen.queryAllByText('Brampton Gamma')).toHaveLength(0);

    expect(screen.getByTestId('stat-total')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-with-teachers')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-needing-teachers')).toHaveTextContent('0');
  });

  it('reveals the disabled level when "Show disabled" is toggled', async () => {
    const user = userEvent.setup();
    renderManagement();

    expect(screen.queryAllByText('Brampton Beta')).toHaveLength(0);

    await user.click(screen.getByLabelText(/show disabled/i));

    expect(screen.getAllByText('Brampton Beta').length).toBeGreaterThan(0);
    // Now 3 Brampton levels (Alpha, Beta, Gamma); withTeachers 2, needing 1.
    expect(screen.getByTestId('stat-total')).toHaveTextContent('3');
    expect(screen.getByTestId('stat-with-teachers')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-needing-teachers')).toHaveTextContent('1');
  });

  it('filters the list by the search box (levelName + curriculum)', async () => {
    const user = userEvent.setup();
    renderManagement();

    await user.type(screen.getByLabelText(/search levels/i), 'gamma');

    expect(screen.getAllByText('Brampton Gamma').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Brampton Alpha')).toHaveLength(0);
    expect(screen.getByTestId('stat-total')).toHaveTextContent('1');
  });
});
