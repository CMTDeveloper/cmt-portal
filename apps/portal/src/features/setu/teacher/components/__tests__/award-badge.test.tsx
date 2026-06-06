import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock('@cmt/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AwardBadge } from '../award-badge';

const ACHIEVEMENTS = [
  { achId: 'a1', title: 'Om Award', description: null, programKey: 'bala-vihar', awardedByName: null, awardedAt: '2026-05-01T00:00:00.000Z' },
];
const PROGRAMS = [{ key: 'bala-vihar', label: 'Bala Vihar' }];

beforeEach(() => {
  mockRefresh.mockReset();
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ achId: 'new' }), { status: 201 })) as never;
});

it('lists existing achievements with a revoke control', () => {
  render(<AwardBadge mid="CMT-F1-02" achievements={ACHIEVEMENTS} programOptions={PROGRAMS} />);
  expect(screen.getByText(/Om Award/)).toBeDefined();
  expect(screen.getByRole('button', { name: /revoke/i })).toBeDefined();
});

it('awards a badge: POSTs the title and refreshes', async () => {
  const user = userEvent.setup();
  render(<AwardBadge mid="CMT-F1-02" achievements={[]} programOptions={PROGRAMS} />);
  await user.type(screen.getByLabelText(/badge title/i), 'Gita L2');
  await user.click(screen.getByRole('button', { name: /award/i }));
  expect(global.fetch).toHaveBeenCalledWith('/api/setu/teacher/achievements', expect.objectContaining({ method: 'POST' }));
  const call = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
  expect(JSON.parse((call[1] as { body: string }).body)).toMatchObject({ mid: 'CMT-F1-02', title: 'Gita L2' });
  expect(mockRefresh).toHaveBeenCalled();
});

it('does not POST when the title is empty', async () => {
  const user = userEvent.setup();
  render(<AwardBadge mid="CMT-F1-02" achievements={[]} programOptions={PROGRAMS} />);
  await user.click(screen.getByRole('button', { name: /award/i }));
  expect(global.fetch).not.toHaveBeenCalled();
});

it('revokes: DELETEs with the mid query param and refreshes', async () => {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as never;
  const user = userEvent.setup();
  render(<AwardBadge mid="CMT-F1-02" achievements={ACHIEVEMENTS} programOptions={PROGRAMS} />);
  await user.click(screen.getByRole('button', { name: /revoke/i }));
  expect(global.fetch).toHaveBeenCalledWith('/api/setu/teacher/achievements/a1?mid=CMT-F1-02', expect.objectContaining({ method: 'DELETE' }));
  expect(mockRefresh).toHaveBeenCalled();
});
