import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children?: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { AttendanceMarker, type MarkerMember } from '../attendance-marker';

const MEMBERS: MarkerMember[] = [
  { mid: 'CMT-A-02', fid: 'CMT-A', firstName: 'Arjun', lastName: 'Apple', schoolGrade: 'Grade 2', hasSafetyInfo: true, status: 'unaccounted' },
  { mid: 'CMT-B-02', fid: 'CMT-B', firstName: 'Bala', lastName: 'Banana', schoolGrade: 'Grade 3', hasSafetyInfo: false, status: 'present' },
];

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: 2, skipped: [] }) }) as unknown as typeof fetch;
});

describe('AttendanceMarker', () => {
  it('seeds marked count from initial statuses (present pre-marked)', () => {
    render(<AttendanceMarker levelId="lvl" levelName="Level 2" ageLabel="Gr 2 & 3" date="2025-09-07" initialMembers={MEMBERS} />);
    expect(screen.getByText('1')).toBeTruthy(); // 1 of 2 marked (Bala present)
    expect(screen.getByText(/\/ 2 marked/)).toBeTruthy();
  });

  it('marking a student increments the count', async () => {
    const user = userEvent.setup();
    render(<AttendanceMarker levelId="lvl" levelName="Level 2" ageLabel="x" date="2025-09-07" initialMembers={MEMBERS} />);
    // Arjun's row has Present/Late/Absent; click Present (first Present button)
    const presentButtons = screen.getAllByRole('button', { name: 'Present' });
    await user.click(presentButtons[0]!);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows a safety dot link for a member with allergies', () => {
    render(<AttendanceMarker levelId="lvl" levelName="Level 2" ageLabel="x" date="2025-09-07" initialMembers={MEMBERS} />);
    expect(screen.getByLabelText('Safety info')).toBeTruthy();
  });

  it('Save posts levelId, date and the marks record', async () => {
    const user = userEvent.setup();
    render(<AttendanceMarker levelId="lvl" levelName="Level 2" ageLabel="x" date="2025-09-07" initialMembers={MEMBERS} />);
    const absentButtons = screen.getAllByRole('button', { name: 'Absent' });
    await user.click(absentButtons[0]!); // Arjun absent
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/setu/teacher/attendance');
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.levelId).toBe('lvl');
    expect(sent.date).toBe('2025-09-07');
    expect(sent.marks).toEqual({ 'CMT-A-02': 'absent', 'CMT-B-02': 'present' });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Thank you for taking attendance today.'));
  });
});
