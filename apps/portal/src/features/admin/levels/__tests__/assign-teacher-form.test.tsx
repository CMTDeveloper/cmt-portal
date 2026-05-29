import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

import { AssignTeacherForm } from '../assign-teacher-form';
import type { LevelRow } from '../levels-table';

const NOW = new Date().toISOString();
const mk = (levelId: string, levelName: string): LevelRow => ({
  levelId, programKey: 'bala-vihar', location: 'Brampton', levelName, levelKind: 'level',
  order: 1, gradeBand: ['1'], ageLabel: 'Grade 1', curriculum: 'X', pid: 'bv-brampton-2025-26',
  periodLabel: '2025-26', teacherRefs: [], enabled: true, createdAt: NOW, createdBy: 'a', updatedAt: NOW, updatedBy: 'a',
});

const LEVELS: LevelRow[] = [mk('l1', 'Level 1'), mk('l2', 'Level 2')];

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ref: 'CMT-X-01', added: ['l1'], removed: [] }) }) as unknown as typeof fetch;
});

describe('AssignTeacherForm', () => {
  it('POSTs ref + selected levelIds', async () => {
    const user = userEvent.setup();
    render(<AssignTeacherForm levels={LEVELS} />);

    await user.type(screen.getByPlaceholderText('CMT-XXXX1111-01'), 'CMT-X-01');
    await user.click(screen.getByLabelText(/Level 1/));
    await user.click(screen.getByText('Save assignment'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/admin/teacher-assignments');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ ref: 'CMT-X-01', levelIds: ['l1'] });
  });

  it('errors when ref is empty', async () => {
    const user = userEvent.setup();
    render(<AssignTeacherForm levels={LEVELS} />);
    await user.click(screen.getByText('Save assignment'));
    expect(toastMock.error).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('allows clearing all levels (empty levelIds)', async () => {
    const user = userEvent.setup();
    render(<AssignTeacherForm levels={LEVELS} />);
    await user.type(screen.getByPlaceholderText('CMT-XXXX1111-01'), 'CMT-X-01');
    await user.click(screen.getByText('Save assignment'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse(((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.levelIds).toEqual([]);
  });
});
