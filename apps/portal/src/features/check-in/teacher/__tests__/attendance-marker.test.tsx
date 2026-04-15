import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttendanceMarker } from '../attendance-marker';
import type { ClassRoster } from '@cmt/shared-domain/check-in';

const roster: ClassRoster = {
  classId: 'K',
  name: 'Kindergarten',
  students: [
    { sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' },
    { sid: '2', fid: '43', firstName: 'Bob', lastName: 'Bravo', level: 'K' },
  ],
};

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
});

describe('AttendanceMarker', () => {
  it('renders one row per student with four status radio buttons', () => {
    render(<AttendanceMarker roster={roster} />);
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/bob/i)).toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: /present/i })).toHaveLength(2);
    expect(screen.getAllByRole('radio', { name: /absent/i })).toHaveLength(2);
    expect(screen.getAllByRole('radio', { name: /late/i })).toHaveLength(2);
    expect(screen.getAllByRole('radio', { name: /uninformed/i })).toHaveLength(2);
  });

  it('defaults all students to present', () => {
    render(<AttendanceMarker roster={roster} />);
    const presentRadios = screen.getAllByRole('radio', { name: /present/i });
    for (const r of presentRadios) expect(r).toBeChecked();
  });

  it('submits status map to /api/check-in/teacher/attendance', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, recorded: 2 }),
    } as Response);

    render(<AttendanceMarker roster={roster} />);
    const absentRadios = screen.getAllByRole('radio', { name: /absent/i });
    await user.click(absentRadios[1]!);  // mark Bob absent
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/teacher/attendance',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const body = JSON.parse(
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.classId).toBe('K');
    expect(body.statuses['1']).toBe('present');
    expect(body.statuses['2']).toBe('absent');
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows error on non-ok response', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal' }),
    } as Response);
    render(<AttendanceMarker roster={roster} />);
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
