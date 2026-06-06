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

function props(over: Record<string, unknown> = {}) {
  return { levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', date: '2026-01-04', rows: ROWS, presentCount: 2, total: 2, ...over };
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
