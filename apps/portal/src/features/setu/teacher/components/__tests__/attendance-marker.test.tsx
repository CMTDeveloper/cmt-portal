import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@cmt/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AttendanceMarker } from '../attendance-marker';
import type { SetuAttendanceStatus } from '@cmt/shared-domain';

// Binary model: F-02 is unmarked (status null), F-03 checked in at the door
// (seeded present). So the default render is 1 present, 1 unmarked.
const ROWS = [
  { mid: 'F-02', fid: 'F', firstName: 'Aarav', lastName: 'Shah', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: null as SetuAttendanceStatus | null, source: 'default' as const, checkedInAtDoor: false },
  { mid: 'F-03', fid: 'F', firstName: 'Diya', lastName: 'Patel', schoolGrade: 'Grade 1', hasSafetyInfo: true, status: 'present' as SetuAttendanceStatus | null, source: 'door' as const, checkedInAtDoor: true },
];

// `today` is set AFTER the fixture `date` (2026-01-04) so the default render is
// a non-future, already-takeable class (canGoNext true → next arrow is a link).
function props(over: Record<string, unknown> = {}) {
  return { levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', date: '2026-01-04', today: '2026-01-18', rows: ROWS, total: 2, ...over };
}

function row(name: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(name, 'i') });
}

beforeEach(() => { global.fetch = vi.fn(async () => new Response(JSON.stringify({ saved: 2, skipped: [] }), { status: 200 })) as never; });

it('seeds Present from a door check-in / prior mark; unmarked rows start un-pressed', () => {
  render(<AttendanceMarker {...props()} />);
  // Diya (door-seeded) is present; Aarav (unmarked) is not.
  expect(row('Diya Patel').getAttribute('aria-pressed')).toBe('true');
  expect(row('Aarav Shah').getAttribute('aria-pressed')).toBe('false');
  // Footer reflects 1 present, not the roster size.
  expect(screen.getByText(/1 present/i)).toBeDefined();
});

it('collapses a prior Late mark to Present (Late is retired)', () => {
  const lateRows = [{ ...ROWS[0]!, status: 'late' as SetuAttendanceStatus | null, source: 'portal' as const }, ROWS[1]!];
  render(<AttendanceMarker {...props({ rows: lateRows })} />);
  expect(row('Aarav Shah').getAttribute('aria-pressed')).toBe('true');
});

it('shows an "arrived" badge for the door-checked-in student', () => {
  render(<AttendanceMarker {...props()} />);
  expect(within(row('Diya Patel')).getByText(/arrived/i)).toBeDefined();
});

it('tapping a row toggles Present on and off', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  const aarav = row('Aarav Shah');
  expect(aarav.getAttribute('aria-pressed')).toBe('false');
  await user.click(aarav);
  expect(screen.getByRole('button', { name: /Aarav Shah/i }).getAttribute('aria-pressed')).toBe('true');
  await user.click(screen.getByRole('button', { name: /Aarav Shah/i }));
  expect(screen.getByRole('button', { name: /Aarav Shah/i }).getAttribute('aria-pressed')).toBe('false');
});

it('Save writes Present for tapped students and Absent for every unmarked one (binary)', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  // Default: Diya present (door), Aarav unmarked. Save → Diya present, Aarav ABSENT.
  await user.click(screen.getByRole('button', { name: /save attendance/i }));
  expect(global.fetch).toHaveBeenCalledWith('/api/setu/teacher/attendance', expect.objectContaining({ method: 'POST' }));
  const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const body = JSON.parse((calls[0]![1] as { body: string }).body);
  expect(body).toMatchObject({ levelId: 'L', date: '2026-01-04', marks: { 'F-02': 'absent', 'F-03': 'present' } });
});

it('Save writes the FULL roster even while a filter/search hides rows', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  // The Unmarked filter hides Diya (door-present), leaving only Aarav visible…
  await user.click(screen.getByRole('button', { name: /^Unmarked 1$/i }));
  expect(screen.queryAllByTestId('att-row')).toHaveLength(1);
  // …but Save must still record BOTH students (filtering is display-only).
  await user.click(screen.getByRole('button', { name: /save attendance/i }));
  const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const body = JSON.parse((calls[0]![1] as { body: string }).body);
  expect(body.marks).toEqual({ 'F-02': 'absent', 'F-03': 'present' });
});

it('keeps Save enabled even when no one is marked (records everyone absent)', () => {
  const allUnmarked = [{ ...ROWS[0]! }, { ...ROWS[1]!, status: null as SetuAttendanceStatus | null, source: 'default' as const, checkedInAtDoor: false }];
  render(<AttendanceMarker {...props({ rows: allUnmarked })} />);
  expect((screen.getByRole('button', { name: /save attendance/i }) as HTMLButtonElement).disabled).toBe(false);
});

it('renders an upcoming card and no roster/save for a future date', () => {
  render(<AttendanceMarker {...props({ date: '2026-06-07', today: '2026-06-06' })} />);
  expect(screen.getByText(/this class is upcoming/i)).toBeDefined();
  expect(screen.queryAllByTestId('att-row')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: /save attendance/i })).toBeNull();
});

it('disables the next arrow when the next Sunday is in the future', () => {
  render(<AttendanceMarker {...props({ date: '2026-06-07', today: '2026-06-08' })} />);
  const next = screen.getByLabelText('Next Sunday');
  expect(next.getAttribute('aria-disabled')).toBe('true');
  expect(next.tagName).not.toBe('A');
});

it('shows the door-aware banner when there are door check-ins but no portal marks', () => {
  render(<AttendanceMarker {...props()} />);
  expect(screen.queryByText(/no check-ins yet/i)).toBeNull();
  expect(screen.getByText(/checked in on arrival/i)).toBeDefined();
});

it('shows the "no check-ins yet" banner when there are no portal marks and no door check-ins', () => {
  const noDoorRows = [{ ...ROWS[0]! }, { ...ROWS[1]!, status: null as SetuAttendanceStatus | null, source: 'default' as const, checkedInAtDoor: false }];
  render(<AttendanceMarker {...props({ rows: noDoorRows })} />);
  expect(screen.getByText(/no check-ins yet/i)).toBeDefined();
});

it('hides the banner once a row has a portal source', () => {
  const savedRows = [{ ...ROWS[0]!, source: 'portal' as const, status: 'absent' as SetuAttendanceStatus | null }, ROWS[1]!];
  render(<AttendanceMarker {...props({ rows: savedRows })} />);
  expect(screen.queryByText(/no check-ins yet/i)).toBeNull();
  expect(screen.queryByText(/checked in on arrival/i)).toBeNull();
});

it('stat strip shows Enrolled, Arrived (door) and a live Present count', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  const strip = screen.getByRole('group', { name: /attendance summary/i });
  const enrolled = within(strip).getByText('Enrolled').closest('div') as HTMLElement;
  expect(within(enrolled).getByText('2')).toBeDefined();
  const arrived = within(strip).getByText('Arrived').closest('div') as HTMLElement;
  expect(within(arrived).getByText('1')).toBeDefined();
  const present = within(strip).getByText('Present').closest('div') as HTMLElement;
  expect(within(present).getByText('1')).toBeDefined();
  // Tap Aarav present → Present 1 → 2.
  await user.click(row('Aarav Shah'));
  const strip2 = screen.getByRole('group', { name: /attendance summary/i });
  const presentCell = within(strip2).getByText('Present').closest('div') as HTMLElement;
  expect(within(presentCell).getByText('2')).toBeDefined();
});

it('footer spells out that unmarked students save as absent', () => {
  render(<AttendanceMarker {...props()} />);
  expect(screen.getByText(/1 unmarked → saved as absent/i)).toBeDefined();
});

it('search filters the roster by name', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  expect(screen.queryAllByTestId('att-row')).toHaveLength(2);
  await user.type(screen.getByLabelText(/search students/i), 'diya');
  expect(screen.queryAllByTestId('att-row')).toHaveLength(1);
  expect(screen.getByText('Diya Patel')).toBeDefined();
  expect(screen.queryByText('Aarav Shah')).toBeNull();
});

it('the Unmarked filter hides students already marked present', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  // Diya is door-present; the Unmarked filter should drop her, leaving Aarav.
  await user.click(screen.getByRole('button', { name: /^Unmarked 1$/i }));
  expect(screen.queryAllByTestId('att-row')).toHaveLength(1);
  expect(screen.getByText('Aarav Shah')).toBeDefined();
  expect(screen.queryByText('Diya Patel')).toBeNull();
});

it('"Mark all present" marks everyone, then toggles to "Clear all"', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  await user.click(screen.getByRole('button', { name: /mark all present/i }));
  expect(row('Aarav Shah').getAttribute('aria-pressed')).toBe('true');
  expect(row('Diya Patel').getAttribute('aria-pressed')).toBe('true');
  // Now everyone's present → the shortcut becomes "Clear all".
  await user.click(screen.getByRole('button', { name: /clear all/i }));
  expect(row('Aarav Shah').getAttribute('aria-pressed')).toBe('false');
});

it('renders the "Next unmarked" jump while students remain unmarked', () => {
  render(<AttendanceMarker {...props()} />);
  expect(screen.getByRole('button', { name: /next unmarked/i })).toBeDefined();
});
