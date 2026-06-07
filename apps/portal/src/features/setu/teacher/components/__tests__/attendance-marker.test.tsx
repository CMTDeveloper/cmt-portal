import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@cmt/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AttendanceMarker } from '../attendance-marker';
import type { SetuAttendanceStatus } from '@cmt/shared-domain';

// Door-seeded model: F-02 is unmarked (status null), F-03 checked in at the
// door (seeded present). So the default render is 1 present, 1 unmarked.
const ROWS = [
  { mid: 'F-02', fid: 'F', firstName: 'Aarav', lastName: 'Shah', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: null as SetuAttendanceStatus | null, source: 'default' as const, checkedInAtDoor: false },
  { mid: 'F-03', fid: 'F', firstName: 'Diya', lastName: 'Patel', schoolGrade: 'Grade 1', hasSafetyInfo: true, status: 'present' as SetuAttendanceStatus | null, source: 'door' as const, checkedInAtDoor: true },
];

// `today` is set AFTER the fixture `date` (2026-01-04) so the default render is
// a non-future, already-takeable class (canGoNext true → next arrow is a link).
function props(over: Record<string, unknown> = {}) {
  return { levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', date: '2026-01-04', today: '2026-01-18', rows: ROWS, total: 2, ...over };
}

beforeEach(() => { global.fetch = vi.fn(async () => new Response(JSON.stringify({ saved: 1, skipped: [] }), { status: 200 })) as never; });

it('seeds from row.status — an unmarked row has no active status button', () => {
  render(<AttendanceMarker {...props()} />);
  expect(screen.getByText('Aarav Shah')).toBeDefined();
  // Footer reflects 1 present (door-seeded Diya), not the roster size.
  expect(screen.getByText(/1 present/i)).toBeDefined();
  // Aarav (unmarked) → none of his three status buttons are pressed.
  const aarav = screen.getByText('Aarav Shah').closest('[data-testid="att-row"]') as HTMLElement;
  const pressed = within(aarav).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
  expect(pressed).toHaveLength(0);
});

it('shows a door badge for the door-checked-in student', () => {
  render(<AttendanceMarker {...props()} />);
  const diya = screen.getByText('Diya Patel').closest('[data-testid="att-row"]') as HTMLElement;
  expect(within(diya).getByText(/door/i)).toBeDefined();
});

it('tapping a status marks it; tapping the active status again unselects it', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  const aarav = screen.getByText('Aarav Shah').closest('[data-testid="att-row"]') as HTMLElement;
  const presentBtn = within(aarav).getByRole('button', { name: /present/i });
  // Mark present.
  await user.click(presentBtn);
  expect(presentBtn.getAttribute('aria-pressed')).toBe('true');
  // Tap the active status again → unselect (back to unmarked, none pressed).
  await user.click(presentBtn);
  const pressed = within(aarav).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
  expect(pressed).toHaveLength(0);
});

it('Save POST body excludes unmarked students (marked-only)', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  // Aarav starts unmarked → must NOT appear in the body. Diya is door-seeded present.
  await user.click(screen.getByRole('button', { name: /save attendance/i }));
  expect(global.fetch).toHaveBeenCalledWith('/api/setu/teacher/attendance', expect.objectContaining({ method: 'POST' }));
  const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const body = JSON.parse((calls[0]![1] as { body: string }).body);
  expect(body).toMatchObject({ levelId: 'L', date: '2026-01-04', marks: { 'F-03': 'present' } });
  expect(body.marks['F-02']).toBeUndefined();
});

it('disables Save when nothing is marked', () => {
  const allUnmarked = [
    { ...ROWS[0]! },
    { ...ROWS[1]!, status: null as SetuAttendanceStatus | null, source: 'default' as const, checkedInAtDoor: false },
  ];
  render(<AttendanceMarker {...props({ rows: allUnmarked })} />);
  const save = screen.getByRole('button', { name: /save attendance/i });
  expect((save as HTMLButtonElement).disabled).toBe(true);
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

it('shows the door-aware banner (marked Present) when there are door check-ins but no portal marks', () => {
  // Default fixture: F-03 is checkedInAtDoor:true, no row is source:'portal'.
  render(<AttendanceMarker {...props()} />);
  // The door case must NOT read as "no check-ins yet" — real attendance came in
  // via the self-check-in door, seeded Present.
  expect(screen.queryByText(/no check-ins yet/i)).toBeNull();
  expect(screen.getByText(/checked in at the door/i)).toBeDefined();
});

it('shows the "no check-ins yet" banner when there are no portal marks and no door check-ins', () => {
  const noDoorRows = [
    { ...ROWS[0]! },
    { ...ROWS[1]!, status: null as SetuAttendanceStatus | null, source: 'default' as const, checkedInAtDoor: false },
  ];
  render(<AttendanceMarker {...props({ rows: noDoorRows })} />);
  expect(screen.getByText(/no check-ins yet/i)).toBeDefined();
});

it('hides every banner once a row has a portal source', () => {
  const savedRows = [
    { ...ROWS[0]!, source: 'portal' as const, status: 'absent' as SetuAttendanceStatus | null },
    ROWS[1]!,
  ];
  render(<AttendanceMarker {...props({ rows: savedRows })} />);
  expect(screen.queryByText(/no check-ins yet/i)).toBeNull();
  expect(screen.queryByText(/checked in at the door/i)).toBeNull();
});

it('renders the stat strip with the door check-in count reflecting checkedInAtDoor rows', () => {
  // One of the two fixture rows (F-03) is checkedInAtDoor:true → Checked in = 1.
  render(<AttendanceMarker {...props()} />);
  const strip = screen.getByRole('group', { name: /attendance summary/i });
  const checkedIn = within(strip).getByText('Checked in').closest('div') as HTMLElement;
  expect(within(checkedIn).getByText('1')).toBeDefined();
  // Enrolled mirrors `total`.
  const enrolled = within(strip).getByText('Enrolled').closest('div') as HTMLElement;
  expect(within(enrolled).getByText('2')).toBeDefined();
});

it('stat strip Present reflects marks (door-seeded), not the roster size', () => {
  render(<AttendanceMarker {...props()} />);
  const strip = screen.getByRole('group', { name: /attendance summary/i });
  const present = within(strip).getByText('Present').closest('div') as HTMLElement;
  const absent = within(strip).getByText('Absent').closest('div') as HTMLElement;
  // Opens with 1 present (Diya, door-seeded) — not 2 (the roster size).
  expect(within(present).getByText('1')).toBeDefined();
  expect(within(absent).getByText('0')).toBeDefined();
});

it('stat strip Present/Absent counts update live as the teacher marks students', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  const strip = screen.getByRole('group', { name: /attendance summary/i });
  const present = within(strip).getByText('Present').closest('div') as HTMLElement;
  const absent = within(strip).getByText('Absent').closest('div') as HTMLElement;
  expect(within(present).getByText('1')).toBeDefined();
  expect(within(absent).getByText('0')).toBeDefined();
  // Mark Aarav absent → Present stays 1, Absent 0→1.
  const aarav = screen.getByText('Aarav Shah').closest('[data-testid="att-row"]') as HTMLElement;
  await user.click(within(aarav).getByRole('button', { name: /absent/i }));
  expect(within(present).getByText('1')).toBeDefined();
  expect(within(absent).getByText('1')).toBeDefined();
});

it('footer shows the unmarked count when students are not marked', () => {
  render(<AttendanceMarker {...props()} />);
  // 1 present (Diya), 1 unmarked (Aarav).
  expect(screen.getByText(/1 not marked/i)).toBeDefined();
});
