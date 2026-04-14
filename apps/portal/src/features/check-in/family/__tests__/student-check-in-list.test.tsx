import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudentCheckInList } from '../student-check-in-list';
import type { Student } from '@cmt/shared-domain/check-in';

const students: Student[] = [
  { sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' },
  { sid: '2', fid: '42', firstName: 'Bob', lastName: 'Acme', level: '1' },
];

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
});

describe('StudentCheckInList', () => {
  it('renders a checkbox for each student, defaulted on', () => {
    render(<StudentCheckInList students={students} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).toBeChecked();
  });

  it('submits POST /api/check-in/family/self-check-in with toggled state', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, checkInIds: ['ci-1', 'ci-2'] }),
    } as Response);

    render(<StudentCheckInList students={students} />);
    await user.click(screen.getAllByRole('checkbox')[1]!);
    await user.click(screen.getByRole('button', { name: /check in/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/family/self-check-in',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ students: { '1': true, '2': false } }),
      }),
    );
  });

  it('shows error on non-ok response', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal' }),
    } as Response);
    render(<StudentCheckInList students={students} />);
    await user.click(screen.getByRole('button', { name: /check in/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
