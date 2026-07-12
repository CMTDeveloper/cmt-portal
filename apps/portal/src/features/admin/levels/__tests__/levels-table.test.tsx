import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

// Inline teacher pills/popover call these client wrappers — mock the -client
// module (never the server fn) per repo rule.
const clientMock = vi.hoisted(() => ({
  searchTeachersClient: vi.fn(),
  addLevelTeacherClient: vi.fn(),
  removeLevelTeacherClient: vi.fn(),
}));
vi.mock('../assign-teacher-client', () => clientMock);

import { LevelsTable, type LevelRow, type LevelTeacher, type PeriodOption } from '../levels-table';

const NOW = new Date().toISOString();

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
  teacherRefs: ['CMT-AAAA1111-01'],
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
    json: async () => ({ levelId: 'brampton-level-1-bv-brampton-2025-26' }),
  }) as unknown as typeof fetch;
});

describe('LevelsTable', () => {
  it('renders existing levels with teacher count', () => {
    render(<LevelsTable initialLevels={[LEVEL]} periods={PERIODS} />);
    // Rendered in both the mobile card list and the desktop table, so match all.
    expect(screen.getAllByText('Level 2')[0]).toBeTruthy();
    expect(screen.getAllByText('Hanuman')[0]).toBeTruthy();
  });

  it('POSTs a new level with the correct payload', async () => {
    const user = userEvent.setup();
    render(<LevelsTable initialLevels={[]} periods={PERIODS} />);

    await user.click(screen.getByText('+ New level'));
    await user.type(screen.getByPlaceholderText('Level 2'), 'Level 1');
    await user.click(screen.getByRole('checkbox', { name: 'Grade 1' }));
    await user.type(screen.getByPlaceholderText('Hanuman'), 'Krishna Krishna');
    await user.type(screen.getByPlaceholderText('teacher@example.com'), 'asha@example.com');
    await user.click(screen.getByText('Create level'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/admin/levels');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      programKey: 'bala-vihar',
      location: 'Brampton',
      pid: 'bv-brampton-2025-26',
      levelName: 'Level 1',
      levelKind: 'level',
      gradeBand: ['1'],
      curriculum: 'Krishna Krishna',
      teacherEmail: 'asha@example.com',
    });
    expect(body).not.toHaveProperty('order');
  });

  it('blocks creating a level/pre-level with no grades', async () => {
    const user = userEvent.setup();
    render(<LevelsTable initialLevels={[]} periods={PERIODS} />);
    await user.click(screen.getByText('+ New level'));
    await user.type(screen.getByPlaceholderText('Level 2'), 'Level 1');
    await user.type(screen.getByPlaceholderText('Hanuman'), 'X');
    await user.click(screen.getByText('Create level'));
    expect(screen.getByText(/need at least one grade/i)).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('PATCHes only changed fields on edit', async () => {
    const user = userEvent.setup();
    render(<LevelsTable initialLevels={[LEVEL]} periods={PERIODS} />);
    await user.click(screen.getAllByText('Edit')[0]!);
    const nameInput = screen.getByDisplayValue('Level 2');
    await user.clear(nameInput);
    await user.type(nameInput, 'Level 2 (B)');
    await user.click(screen.getByText('Save changes'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/admin/levels/brampton-level-2-bv-brampton-2025-26');
    expect((init as RequestInit).method).toBe('PATCH');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ levelName: 'Level 2 (B)' });
  });
});

describe('LevelsTable — read-only teacher summary', () => {
  // Teacher management (add/remove/lead) now lives in the detail panel; the row
  // shows a read-only summary paired by mid, with a Lead/Assistant hint.
  const LEVEL_WITH_LEAD: LevelRow = { ...LEVEL, leadTeacherRef: 'CMT-AAAA1111-01' };
  const TWO_TEACHERS: Record<string, LevelTeacher[]> = {
    [LEVEL.levelId]: [
      { mid: 'CMT-AAAA1111-01', name: 'Meera Rao' },
      { mid: 'CMT-BBBB2222-01', name: 'Anil Kumar' },
    ],
  };

  it('renders a read-only name pill per teacher (N=2) with a Lead/Assistant hint', () => {
    render(<LevelsTable initialLevels={[LEVEL_WITH_LEAD]} periods={PERIODS} teachersByLevel={TWO_TEACHERS} />);
    // Rendered in both the mobile card and the desktop table, so match all.
    expect(screen.getAllByText('Meera Rao')[0]).toBeTruthy();
    expect(screen.getAllByText('Anil Kumar')[0]).toBeTruthy();
    // Lead/Assistant hint reflects leadTeacherRef (Meera is Lead, Anil is Asst).
    expect(screen.getAllByText('Lead')[0]).toBeTruthy();
    expect(screen.getAllByText('Asst')[0]).toBeTruthy();
  });

  it('exposes no add/remove teacher controls in the row (panel-only)', () => {
    render(<LevelsTable initialLevels={[LEVEL_WITH_LEAD]} periods={PERIODS} teachersByLevel={TWO_TEACHERS} />);
    expect(screen.queryByRole('button', { name: /assign teacher/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    // No legacy "Teacher assignments" tab anywhere.
    expect(screen.queryByRole('tab', { name: 'Teacher assignments' })).toBeNull();
  });
});
