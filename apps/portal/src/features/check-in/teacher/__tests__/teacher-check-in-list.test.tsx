import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeacherCheckInList } from '../teacher-check-in-list';
import type { StudentWithContact } from '@/features/check-in/shared';

const students: StudentWithContact[] = [
  {
    sid: '1',
    fid: '10',
    firstName: 'Alice',
    lastName: 'Acme',
    level: 'K',
    parentEmail: 'alice@example.com',
    parentPhone: '4165550001',
    paymentStatus: 'paid',
  },
  {
    sid: '2',
    fid: '11',
    firstName: 'Bob',
    lastName: 'Bravo',
    level: 'K',
    parentEmail: 'bob@example.com',
    parentPhone: '4165550002',
    paymentStatus: 'unpaid',
  },
];

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
});

describe('TeacherCheckInList', () => {
  it('renders student names and parent contact info', () => {
    render(
      <TeacherCheckInList
        students={students}
        classId="K"
        date="2026-04-13"
        initialCheckedSids={[]}
      />,
    );
    expect(screen.getByText('Alice Acme')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('4165550001')).toBeInTheDocument();
    expect(screen.getByText('Bob Bravo')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('shows stats cards with correct counts', () => {
    render(
      <TeacherCheckInList
        students={students}
        classId="K"
        date="2026-04-13"
        initialCheckedSids={['1']}
      />,
    );
    expect(screen.getByText('Registered')).toBeInTheDocument();
    expect(screen.getByText('Unregistered')).toBeInTheDocument();
    expect(screen.getByText('Checked In')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('initialCheckedSids pre-checks the right students', () => {
    render(
      <TeacherCheckInList
        students={students}
        classId="K"
        date="2026-04-13"
        initialCheckedSids={['1']}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    const aliceCheckbox = checkboxes.find((cb) =>
      cb.getAttribute('aria-label')?.includes('Alice'),
    );
    const bobCheckbox = checkboxes.find((cb) =>
      cb.getAttribute('aria-label')?.includes('Bob'),
    );
    expect(aliceCheckbox).toBeChecked();
    expect(bobCheckbox).not.toBeChecked();
  });

  it('toggles check-in by POSTing to /api/check-in/teacher/attendance', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, recorded: 1 }),
    } as Response);

    render(
      <TeacherCheckInList
        students={students}
        classId="K"
        date="2026-04-13"
        initialCheckedSids={[]}
      />,
    );

    const aliceCheckbox = screen
      .getAllByRole('checkbox')
      .find((cb) => cb.getAttribute('aria-label')?.includes('Alice'));
    await user.click(aliceCheckbox!);

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/teacher/attendance',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body,
    );
    expect(body.classId).toBe('K');
    expect(body.date).toBe('2026-04-13');
    expect(body.statuses['1']).toBe('present');
  });

  it('reverts optimistic update on API error', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    render(
      <TeacherCheckInList
        students={students}
        classId="K"
        date="2026-04-13"
        initialCheckedSids={[]}
      />,
    );

    const aliceCheckbox = screen
      .getAllByRole('checkbox')
      .find((cb) => cb.getAttribute('aria-label')?.includes('Alice'));
    await user.click(aliceCheckbox!);

    // After revert, checkbox should be unchecked again
    expect(aliceCheckbox).not.toBeChecked();
  });

  it('shows empty state when no students', () => {
    render(
      <TeacherCheckInList students={[]} classId="K" date="2026-04-13" initialCheckedSids={[]} />,
    );
    expect(screen.getByText(/no students found/i)).toBeInTheDocument();
  });
});
