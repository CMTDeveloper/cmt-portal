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
import type { AttendanceViewRow } from '../../level-attendance-view';

/**
 * One row, with the spec §4.4 detail fields defaulted.
 *
 * They are REQUIRED on `AttendanceViewRow` on purpose - an optional field reads
 * `undefined` at a construction site nobody updated and renders blank with no
 * error - so every fixture must supply them. This factory is where that cost is
 * paid once, rather than at each of the literals scattered through this file.
 */
function mkRow(over: Partial<AttendanceViewRow> & Pick<AttendanceViewRow, 'mid' | 'fid' | 'firstName' | 'lastName'>): AttendanceViewRow {
  return {
    schoolGrade: 'Grade 1',
    hasSafetyInfo: false,
    status: null as SetuAttendanceStatus | null,
    source: 'default',
    checkedInAtDoor: false,
    parentName: null,
    parentPhone: null,
    parentEmail: null,
    payment: 'unknown',
    safetyNotes: null,
    ...over,
  };
}

// Binary model: F-02 is unmarked (status null), F-03 checked in at the door
// (seeded present). So the default render is 1 present, 1 unmarked.
// Both carry realistic contact + payment: a fixture with the detail fields
// blank could not tell "the row does not render contact" from "this row has
// none", which is the shape of bug this whole task adds.
const ROWS: AttendanceViewRow[] = [
  mkRow({ mid: 'F-02', fid: 'F', firstName: 'Aarav', lastName: 'Shah', parentName: 'Meera Shah', parentPhone: '416-555-0100', parentEmail: 'meera@example.com', payment: 'outstanding' }),
  mkRow({ mid: 'F-03', fid: 'F', firstName: 'Diya', lastName: 'Patel', hasSafetyInfo: true, safetyNotes: 'Severe peanut allergy', status: 'present', source: 'door', checkedInAtDoor: true, parentName: 'Nikhil Patel', parentPhone: '416-555-0200', parentEmail: 'nikhil@example.com', payment: 'paid' }),
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

it('re-seeds a newly-enrolled member as Present when router.refresh() delivers fresh rows (no remount)', () => {
  // Simulates: mark a child from "Not in this class yet" → they enroll + get a
  // present event → router.refresh() re-renders THIS component with new rows.
  // The child must show marked immediately, not only after a hard reload.
  const { rerender } = render(<AttendanceMarker {...props()} />);
  expect(screen.queryByRole('button', { name: /Child6 Family6/i })).toBeNull();

  const newChild = mkRow({ mid: 'F-99', fid: 'F6', firstName: 'Child6', lastName: 'Family6', status: 'present', source: 'portal' });
  rerender(<AttendanceMarker {...props({ rows: [...ROWS, newChild], total: 3 })} />);

  // The freshly-enrolled child appears AND is pressed (Present), without a remount.
  expect(row('Child6 Family6').getAttribute('aria-pressed')).toBe('true');
});

it('preserves the teacher\'s in-progress taps when router.refresh() delivers fresh rows', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<AttendanceMarker {...props()} />);
  // Tap Aarav (server-unmarked) → present locally, not yet saved.
  await user.click(row('Aarav Shah'));
  expect(row('Aarav Shah').getAttribute('aria-pressed')).toBe('true');

  // A refresh arrives with a new member; Aarav's local tap must NOT be reverted
  // to his (still-unmarked) server status.
  const newChild = mkRow({ mid: 'F-99', fid: 'F6', firstName: 'Child6', lastName: 'Family6' });
  rerender(<AttendanceMarker {...props({ rows: [...ROWS, newChild], total: 3 })} />);
  expect(row('Aarav Shah').getAttribute('aria-pressed')).toBe('true');
});

// ─── Task 5: the row restructure + the §4.4 detail on the row ─────────────────
//
// `row()` above still resolves the TOGGLE button, which is where `aria-pressed`
// and the student's accessible name live after the restructure - so all ~18
// existing usages keep working unchanged. `rowEl()` is the new row CONTAINER,
// for assertions that need the whole row (the contact line, the chip, the link).
function rowEl(name: string): HTMLElement {
  const found = screen.getAllByTestId('att-row').find((r) => new RegExp(name, 'i').test(r.textContent ?? ''));
  if (!found) throw new Error(`no attendance row for ${name}`);
  return found;
}

it('the row is a container, not a button - so it can hold a link', () => {
  render(<AttendanceMarker {...props()} />);
  // The container must NOT be a button and must NOT carry role="button": either
  // would put an <a> inside a button, the invalid nesting this restructure fixes.
  const el = rowEl('Aarav Shah');
  expect(el.tagName).not.toBe('BUTTON');
  expect(el.getAttribute('role')).toBeNull();
  // aria-pressed lives on the TOGGLE now, so keyboard users reach the toggle and
  // the link independently. Losing it here would be an a11y regression.
  expect(el.getAttribute('aria-pressed')).toBeNull();
  expect(within(el).getByRole('button', { name: /Aarav Shah/i }).getAttribute('aria-pressed')).toBe('false');
});

it('each row links to the student profile, and following it does NOT toggle', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  const link = within(rowEl('Aarav Shah')).getByRole('link', { name: /view profile/i });
  expect(link).toHaveProperty('href');
  expect(link.getAttribute('href')).toBe('/teacher/students/F-02');

  expect(row('Aarav Shah').getAttribute('aria-pressed')).toBe('false');
  await user.click(link);
  // The container's tap-to-mark must not fire for a click that began in a link.
  expect(row('Aarav Shah').getAttribute('aria-pressed')).toBe('false');
  expect(global.fetch).not.toHaveBeenCalled();
});

it('tapping the row body still marks present (the gesture survives the restructure)', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  await user.click(rowEl('Aarav Shah'));
  expect(row('Aarav Shah').getAttribute('aria-pressed')).toBe('true');
});

it('shows the parent contact on the row', () => {
  render(<AttendanceMarker {...props()} />);
  const el = rowEl('Aarav Shah');
  expect(within(el).getByText(/Meera Shah/)).toBeDefined();
  expect(within(el).getByText(/416-555-0100/)).toBeDefined();
});

it('shows a payment chip ONLY for paid and outstanding', () => {
  render(<AttendanceMarker {...props()} />);
  // The two a teacher can act on.
  expect(within(rowEl('Aarav Shah')).getByText('Outstanding')).toBeDefined();
  expect(within(rowEl('Diya Patel')).getByText('Paid')).toBeDefined();

  // `not-applicable` and `unknown` render NO chip - labelling either would
  // assert something we cannot stand behind (owner decision 2026-07-26).
  const quiet = [
    mkRow({ mid: 'Q-01', fid: 'Q', firstName: 'Quiet', lastName: 'One', payment: 'unknown' }),
    mkRow({ mid: 'Q-02', fid: 'Q2', firstName: 'Quiet', lastName: 'Two', payment: 'not-applicable' }),
  ];
  render(<AttendanceMarker {...props({ rows: quiet, total: 2 })} />);
  for (const name of ['Quiet One', 'Quiet Two']) {
    const el = rowEl(name);
    expect(within(el).queryByText('Paid')).toBeNull();
    expect(within(el).queryByText('Outstanding')).toBeNull();
    expect(within(el).queryByText(/not.applicable|unknown|N\/A/i)).toBeNull();
  }
});

it('gives the safety dot an accessible label instead of leaving it a bare colour', () => {
  render(<AttendanceMarker {...props()} />);
  // Diya has safetyNotes; Aarav does not.
  expect(within(rowEl('Diya Patel')).getByRole('img', { name: /allergy|safety/i })).toBeDefined();
  expect(within(rowEl('Aarav Shah')).queryByRole('img', { name: /allergy|safety/i })).toBeNull();
});

it('surfaces the allergy text itself, not only the dot', () => {
  render(<AttendanceMarker {...props()} />);
  expect(within(rowEl('Diya Patel')).getByText(/Severe peanut allergy/)).toBeDefined();
});

it('shows Enrolled / Present / Unmarked stat cards - and no Absent card', () => {
  render(<AttendanceMarker {...props()} />);
  // 2 enrolled, 1 present (Diya, door-seeded), 1 unmarked.
  const stats = screen.getByTestId('att-stats');
  expect(within(stats).getByText(/^Enrolled$/i)).toBeDefined();
  expect(within(stats).getByText(/^Present$/i)).toBeDefined();
  expect(within(stats).getByText(/^Unmarked$/i)).toBeDefined();
  // Absent is fused with Unmarked in the binary model (owner decision
  // 2026-07-26), so a fourth card would be a number we cannot compute.
  expect(within(stats).queryByText(/^Absent$/i)).toBeNull();
  expect(within(stats).getByTestId('stat-enrolled').textContent).toContain('2');
  expect(within(stats).getByTestId('stat-present').textContent).toContain('1');
  expect(within(stats).getByTestId('stat-unmarked').textContent).toContain('1');
});

it('the stat cards track taps live', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  await user.click(row('Aarav Shah'));
  const stats = screen.getByTestId('att-stats');
  expect(within(stats).getByTestId('stat-present').textContent).toContain('2');
  expect(within(stats).getByTestId('stat-unmarked').textContent).toContain('0');
});
