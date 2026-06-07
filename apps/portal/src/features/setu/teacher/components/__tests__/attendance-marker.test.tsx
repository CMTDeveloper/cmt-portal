import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@cmt/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AttendanceMarker } from '../attendance-marker';

const ROWS = [
  { mid: 'F-02', fid: 'F', firstName: 'Aarav', lastName: 'Shah', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: 'present' as const, source: 'default' as const, checkedInAtDoor: false },
  { mid: 'F-03', fid: 'F', firstName: 'Diya', lastName: 'Patel', schoolGrade: 'Grade 1', hasSafetyInfo: true, status: 'present' as const, source: 'door' as const, checkedInAtDoor: true },
];

// `today` is set AFTER the fixture `date` (2026-01-04) so the default render is
// a non-future, already-takeable class (canGoNext true → next arrow is a link).
function props(over: Record<string, unknown> = {}) {
  return { levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', date: '2026-01-04', today: '2026-01-18', rows: ROWS, presentCount: 2, total: 2, ...over };
}

beforeEach(() => { global.fetch = vi.fn(async () => new Response(JSON.stringify({ saved: 2, skipped: [] }), { status: 200 })) as never; });

it('opens with everyone present and shows the live present count', () => {
  render(<AttendanceMarker {...props()} />);
  expect(screen.getByText('Aarav Shah')).toBeDefined();
  expect(screen.getByText(/2\s*\/\s*2 present/i)).toBeDefined();
});

it('shows a door badge for the door-checked-in student', () => {
  render(<AttendanceMarker {...props()} />);
  const diya = screen.getByText('Diya Patel').closest('[data-testid="att-row"]') as HTMLElement;
  expect(within(diya).getByText(/door/i)).toBeDefined();
});

it('flagging a student absent decrements the present count and posts the full marks map', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  const aarav = screen.getByText('Aarav Shah').closest('[data-testid="att-row"]') as HTMLElement;
  await user.click(within(aarav).getByRole('button', { name: /absent/i }));
  expect(screen.getByText(/1\s*\/\s*2 present/i)).toBeDefined();
  await user.click(screen.getByRole('button', { name: /save attendance/i }));
  expect(global.fetch).toHaveBeenCalledWith('/api/setu/teacher/attendance', expect.objectContaining({ method: 'POST' }));
  const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const body = JSON.parse((calls[0]![1] as { body: string }).body);
  expect(body).toMatchObject({ levelId: 'L', date: '2026-01-04', marks: { 'F-02': 'absent', 'F-03': 'present' } });
});

it('renders an upcoming card and no roster/save for a future date', () => {
  // date (2026-06-07) is after today (2026-06-06) → class hasn't happened.
  render(<AttendanceMarker {...props({ date: '2026-06-07', today: '2026-06-06' })} />);
  expect(screen.getByText(/this class is upcoming/i)).toBeDefined();
  expect(screen.queryAllByTestId('att-row')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: /save attendance/i })).toBeNull();
});

it('disables the next arrow when the next Sunday is in the future', () => {
  // date 2026-06-07, today 2026-06-08 → addDays(date,7)=2026-06-14 > today.
  render(<AttendanceMarker {...props({ date: '2026-06-07', today: '2026-06-08' })} />);
  const next = screen.getByLabelText('Next Sunday');
  expect(next.getAttribute('aria-disabled')).toBe('true');
  expect(next.tagName).not.toBe('A'); // not a link
});

it('shows the "not taken yet" banner when no row was saved in the portal', () => {
  // All fixture rows are source default/door → not yet taken.
  render(<AttendanceMarker {...props()} />);
  expect(screen.getByText(/not taken yet/i)).toBeDefined();
});

it('hides the "not taken yet" banner once a row has a portal source', () => {
  const savedRows = [
    { ...ROWS[0]!, source: 'portal' as const, status: 'absent' as const },
    ROWS[1]!,
  ];
  render(<AttendanceMarker {...props({ rows: savedRows })} />);
  expect(screen.queryByText(/not taken yet/i)).toBeNull();
});
