import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

import { LevelsManagement } from '../levels-management';
import type { LevelRow, PeriodOption } from '../levels-table';
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

describe('LevelsManagement', () => {
  it('separates levels and teacher assignments into tabs', async () => {
    const user = userEvent.setup();
    render(<LevelsManagement initialLevels={LEVELS} periods={PERIODS} programs={PROGRAMS} />);

    expect(screen.getAllByText('Level 1')[0]).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Teacher assignments' }));

    expect(screen.getByRole('tabpanel', { name: 'Teacher assignments' })).toBeTruthy();
    expect(screen.getByPlaceholderText('teacher@example.com')).toBeTruthy();
  });

  it('disables the "New level" control when readOnly (viewing a past year)', () => {
    render(<LevelsManagement initialLevels={LEVELS} periods={PERIODS} programs={PROGRAMS} readOnly />);
    expect(screen.getByText('Viewing a past year — read-only.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /new level/i })).toBeDisabled();
  });
});

