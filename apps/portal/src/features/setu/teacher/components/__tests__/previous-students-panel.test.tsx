import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));
const refreshMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
import { PreviousStudentsPanel } from '../previous-students-panel';

const initial = [
  { mid: 'C-02', fid: 'C', firstName: 'Cara', lastName: 'Cherry', schoolGrade: 'Grade 2' },
  { mid: 'C-03', fid: 'C', firstName: 'Cody', lastName: 'Cherry', schoolGrade: 'Grade 3' },
  { mid: 'D-02', fid: 'D', firstName: 'Dan', lastName: 'Date', schoolGrade: 'Grade 2' },
];

beforeEach(() => { toastMock.success.mockReset(); toastMock.error.mockReset(); refreshMock.mockReset(); vi.restoreAllMocks(); });

describe('PreviousStudentsPanel', () => {
  it('marks a previous student present and removes the whole family from the list', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ok: true, fid: 'C' }) } as Response);
    const user = userEvent.setup();
    render(<PreviousStudentsPanel levelId="L" levelName="Level 2" ageLabel="Gr 2 & 3" date="2026-01-18" initial={initial} />);
    expect(screen.getByText('Cara Cherry')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: /mark present/i })[0]!);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    // both Cherry siblings gone; the Date family remains
    expect(screen.queryByText('Cara Cherry')).toBeNull();
    expect(screen.queryByText('Cody Cherry')).toBeNull();
    expect(screen.getByText('Dan Date')).toBeTruthy();
    // Router Cache invalidated so "Back to attendance" shows the new Present mark.
    expect(refreshMock).toHaveBeenCalled();
  });

  it('renders the empty state when there are no previous students', () => {
    render(<PreviousStudentsPanel levelId="L" levelName="Level 2" ageLabel="Gr 2 & 3" date="2026-01-18" initial={[]} />);
    expect(screen.getByText(/everyone on this roster is enrolled/i)).toBeTruthy();
  });
});
