import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

import { LevelsTable, type LevelRow, type PeriodOption } from '../levels-table';
import type { ProgramRow } from '../../programs/programs-table';

const NOW = new Date().toISOString();

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

const PERIODS: PeriodOption[] = [
  { pid: 'bv-brampton-2025-26', periodLabel: '2025-26', location: 'Brampton' },
];

const LEVEL: LevelRow = {
  levelId: 'brampton-level-2-bv-brampton-2025-26',
  programKey: 'bala-vihar',
  location: 'Brampton',
  levelName: 'Level 2',
  levelKind: 'level',
  order: 4,
  gradeBand: ['2', '3'],
  ageLabel: 'Grade 2 & 3',
  curriculum: 'Hanuman',
  pid: 'bv-brampton-2025-26',
  periodLabel: '2025-26',
  teacherRefs: [],
  enabled: true,
  createdAt: NOW,
  createdBy: 'admin',
  updatedAt: NOW,
  updatedBy: 'admin',
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ levelId: 'test-level-id' }),
  }) as unknown as typeof fetch;
});

describe('LevelsTable — program filter', () => {
  it('renders a program select when programs are provided', () => {
    render(<LevelsTable initialLevels={[LEVEL]} periods={PERIODS} programs={PROGRAMS} />);
    const select = screen.getByLabelText(/program/i);
    expect(select).toBeTruthy();
    expect((select as HTMLSelectElement).value).toBe('bala-vihar');
  });

  it('renders program options for usesLevels programs', () => {
    render(<LevelsTable initialLevels={[LEVEL]} periods={PERIODS} programs={PROGRAMS} />);
    // Both bala-vihar and tabla have usesLevels: true
    expect(screen.getByRole('option', { name: 'Bala Vihar' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Tabla' })).toBeTruthy();
  });

  it('works without programs prop (backward compat)', () => {
    render(<LevelsTable initialLevels={[LEVEL]} periods={PERIODS} />);
    // No program select rendered when programs not provided
    expect(screen.queryByLabelText(/program/i)).toBeNull();
  });

  it('includes programKey in new level POST body when program selected', async () => {
    const user = userEvent.setup();
    render(<LevelsTable initialLevels={[]} periods={PERIODS} programs={PROGRAMS} />);

    await user.click(screen.getByText('+ New level'));
    await user.type(screen.getByPlaceholderText('Level 2'), 'Level 1');
    await user.click(screen.getByRole('checkbox', { name: 'Grade 1' }));
    await user.type(screen.getByPlaceholderText('Hanuman'), 'Basics');
    await user.click(screen.getByText('Create level'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.programKey).toBe('bala-vihar');
  });
});
