import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@cmt/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The inline "Not in this class yet" section (rendered on non-future dates) uses
// useRouter; stub it so these marker tests don't need a router provider.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
  return { levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', date: '2026-01-04', today: '2026-01-18', rows: ROWS, total: 2, previousCount: 0, previousStudents: [], ...over };
}

function row(name: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(name, 'i') });
}

/** The JSON body of the most recent POST /api/setu/teacher/attendance call. */
function lastFetchBody(): { levelId: string; date: string; marks: Record<string, string> } {
  const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const init = calls[calls.length - 1]![1] as { body: string };
  return JSON.parse(init.body);
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

it('door check-ins are simply Present — no separate "arrived" badge', () => {
  render(<AttendanceMarker {...props()} />);
  // Diya is door-seeded Present (pressed) with no extra "arrived" chip.
  expect(row('Diya Patel').getAttribute('aria-pressed')).toBe('true');
  expect(within(row('Diya Patel')).queryByText(/arrived/i)).toBeNull();
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

it('auto-saves present for the tapped student and absent for the rest (no Save button)', async () => {
  const user = userEvent.setup();
  const allUnmarked = [{ ...ROWS[0]! }, { ...ROWS[1]!, status: null as SetuAttendanceStatus | null, source: 'default' as const, checkedInAtDoor: false }];
  render(<AttendanceMarker {...props({ rows: allUnmarked })} />);
  // No manual Save — tapping schedules a debounced autosave of the WHOLE roster.
  expect(screen.queryByRole('button', { name: /save attendance/i })).toBeNull();
  await user.click(row('Aarav Shah')); // Aarav present; Diya stays unmarked → absent
  await waitFor(
    () => expect(global.fetch).toHaveBeenCalledWith('/api/setu/teacher/attendance', expect.objectContaining({ method: 'POST' })),
    { timeout: 1500 },
  );
  expect(lastFetchBody()).toMatchObject({ levelId: 'L', date: '2026-01-04', marks: { 'F-02': 'present', 'F-03': 'absent' } });
});

it('auto-saves the FULL roster even while a filter hides rows', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />); // Diya door-present, Aarav unmarked
  await user.click(screen.getByRole('button', { name: /^Unmarked 1$/i })); // hides Diya
  expect(screen.queryAllByTestId('att-row')).toHaveLength(1);
  await user.click(row('Aarav Shah')); // tap the only visible student
  await waitFor(() => expect(global.fetch).toHaveBeenCalled(), { timeout: 1500 });
  // The save still records BOTH students (filtering is display-only).
  expect(lastFetchBody().marks).toEqual({ 'F-02': 'present', 'F-03': 'present' });
});

it('shows "Saved" after a tap auto-saves', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  await user.click(row('Aarav Shah'));
  await waitFor(() => expect(screen.getByRole('status').textContent ?? '').toMatch(/saved/i), { timeout: 1500 });
});

it('surfaces a Retry when the auto-save fails, then recovers on retry', async () => {
  const user = userEvent.setup();
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response('nope', { status: 500 }));
  render(<AttendanceMarker {...props()} />);
  await user.click(row('Aarav Shah'));
  const retry = await screen.findByRole('button', { name: /retry/i }, { timeout: 1500 });
  await user.click(retry); // next call uses the default 200 mock
  await waitFor(() => expect(screen.getByRole('status').textContent ?? '').toMatch(/saved/i), { timeout: 1500 });
});

it('renders an upcoming card and no roster/save bar for a future date', () => {
  render(<AttendanceMarker {...props({ date: '2026-06-07', today: '2026-06-06' })} />);
  expect(screen.getByText(/this class is upcoming/i)).toBeDefined();
  expect(screen.queryAllByTestId('att-row')).toHaveLength(0);
  // No bottom autosave bar for a future (not-yet-takeable) class.
  expect(screen.queryByRole('status')).toBeNull();
});

it('disables the next arrow when the next Sunday is in the future', () => {
  render(<AttendanceMarker {...props({ date: '2026-06-07', today: '2026-06-08' })} />);
  const next = screen.getByLabelText('Next Sunday');
  expect(next.getAttribute('aria-disabled')).toBe('true');
  expect(next.tagName).not.toBe('A');
});

it('shows the door-aware banner when there are door check-ins but no portal marks', () => {
  render(<AttendanceMarker {...props()} />);
  expect(screen.queryByText(/recorded absent/i)).toBeNull(); // not the no-door banner
  expect(screen.getByText(/checked in on arrival/i)).toBeDefined();
});

it('shows the no-door banner (tap present, auto-saves, rest absent) when there are no marks or check-ins', () => {
  const noDoorRows = [{ ...ROWS[0]! }, { ...ROWS[1]!, status: null as SetuAttendanceStatus | null, source: 'default' as const, checkedInAtDoor: false }];
  render(<AttendanceMarker {...props({ rows: noDoorRows })} />);
  expect(screen.getByText(/recorded absent/i)).toBeDefined();
});

it('hides the banner once a row has a portal source', () => {
  const savedRows = [{ ...ROWS[0]!, source: 'portal' as const, status: 'absent' as SetuAttendanceStatus | null }, ROWS[1]!];
  render(<AttendanceMarker {...props({ rows: savedRows })} />);
  expect(screen.queryByText(/no check-ins yet/i)).toBeNull();
  expect(screen.queryByText(/checked in on arrival/i)).toBeNull();
});

it('stat strip shows Enrolled and a live Present count (no Arrived)', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  const strip = screen.getByRole('group', { name: /attendance summary/i });
  const enrolled = within(strip).getByText('Enrolled').closest('div') as HTMLElement;
  expect(within(enrolled).getByText('2')).toBeDefined();
  // "Arrived" is retired — door check-ins are just Present.
  expect(within(strip).queryByText('Arrived')).toBeNull();
  const present = within(strip).getByText('Present').closest('div') as HTMLElement;
  expect(within(present).getByText('1')).toBeDefined();
  // Tap Aarav present → Present 1 → 2.
  await user.click(row('Aarav Shah'));
  const strip2 = screen.getByRole('group', { name: /attendance summary/i });
  const presentCell = within(strip2).getByText('Present').closest('div') as HTMLElement;
  expect(within(presentCell).getByText('2')).toBeDefined();
});

it('footer shows the auto-save hint before any change', () => {
  render(<AttendanceMarker {...props()} />);
  expect(screen.getByText(/tap present as they arrive/i)).toBeDefined();
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

it('renders previous students inline in the consolidated "Not in this class yet" section (no /previous page link)', async () => {
  const user = userEvent.setup();
  render(
    <AttendanceMarker
      {...props({ previousStudents: [{ mid: 'P-1', fid: 'P', firstName: 'Harshita', lastName: 'M', schoolGrade: 'Grade 2' }] })}
    />,
  );
  // The separate /previous page link is gone — previous students moved inline.
  expect(screen.queryByRole('link', { name: /previous students/i })).toBeNull();
  expect(screen.getByText(/enrolled students \(2\)/i)).toBeDefined();
  // Expand the consolidated section → the previous student is listed there.
  await user.click(screen.getByRole('button', { name: /not in this class yet/i }));
  expect(await screen.findByText('Harshita M')).toBeDefined();
  expect(screen.getByText(/Previous students \(1\)/i)).toBeDefined();
});

it('shows the "Not in this class yet" section even with zero previous students (to find registered kids)', () => {
  render(<AttendanceMarker {...props({ previousStudents: [] })} />);
  // Always present on a non-future date so a teacher can expand it to enroll a
  // registered-but-unenrolled child (Vaibhav's family6 case).
  expect(screen.getByRole('button', { name: /not in this class yet/i })).toBeDefined();
});
