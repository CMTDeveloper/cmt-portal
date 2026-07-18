import { it, expect, vi, beforeEach, describe } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock('@cmt/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NotInClassSection } from '../not-in-class-section';

const PREV = [{ mid: 'PREV-1', fid: 'FAM-P', firstName: 'Harshita', lastName: 'M', schoolGrade: 'Grade 2' }];
const ELIGIBLE = [{ mid: 'FAM-6-03', fid: 'FAM-6', firstName: 'Child1', lastName: 'Family6', schoolGrade: 'Grade 2', familyName: 'Family6' }];

function mockFetch(eligible = ELIGIBLE) {
  global.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (typeof url === 'string' && url.includes('grade-eligible') && (!init || init.method !== 'POST')) {
      return new Response(JSON.stringify({ view: { students: eligible } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, autoEnrolled: true }), { status: 200 });
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch();
});

describe('NotInClassSection', () => {
  it('is collapsed by default and does not fetch the registered group until opened', () => {
    render(<NotInClassSection levelId="L" date="2026-10-04" previousStudents={PREV} />);
    expect(screen.queryByText('Child1 Family6')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('lazy-loads the registered-not-enrolled group on expand and shows both headed groups', async () => {
    const user = userEvent.setup();
    render(<NotInClassSection levelId="L" date="2026-10-04" previousStudents={PREV} />);
    await user.click(screen.getByRole('button', { name: /not in this class yet/i }));

    expect(screen.getByText(/Previous students \(1\)/i)).toBeDefined();
    expect(screen.getByText('Harshita M')).toBeDefined();
    expect(screen.getByText(/Registered · not enrolled/i)).toBeDefined();
    expect(await screen.findByText('Child1 Family6')).toBeDefined();
    // The registered group was fetched exactly once, GET, for this level.
    const getCalls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('grade-eligible'),
    );
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0]![0]).toContain('levelId=L');
  });

  it('marking a previous student confirms via confirm-previous and drops the family', async () => {
    const user = userEvent.setup();
    render(<NotInClassSection levelId="L" date="2026-10-04" previousStudents={PREV} />);
    await user.click(screen.getByRole('button', { name: /not in this class yet/i }));
    await screen.findByText('Harshita M');

    // Registered · not enrolled renders FIRST now, so scope to Harshita's card
    // (the Previous group) rather than the first Mark-present button.
    const harshitaCard = screen.getByText('Harshita M').closest('.card') as HTMLElement;
    await user.click(within(harshitaCard).getByRole('button', { name: /mark present/i }));
    await waitFor(() => {
      const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      expect(calls.some((c) => (c[0] as string) === '/api/setu/teacher/attendance/confirm-previous')).toBe(true);
    });
    await waitFor(() => expect(screen.queryByText('Harshita M')).toBeNull());
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('marking a registered child enrolls via grade-eligible POST and drops the row', async () => {
    const user = userEvent.setup();
    render(<NotInClassSection levelId="L" date="2026-10-04" previousStudents={[]} />);
    await user.click(screen.getByRole('button', { name: /not in this class yet/i }));
    await screen.findByText('Child1 Family6');

    await user.click(screen.getByRole('button', { name: /mark present/i }));
    await waitFor(() => {
      const posts = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
        (c) => (c[0] as string) === '/api/setu/teacher/grade-eligible' && (c[1] as { method?: string })?.method === 'POST',
      );
      expect(posts).toHaveLength(1);
    });
    await waitFor(() => expect(screen.queryByText('Child1 Family6')).toBeNull());
  });

  it('renders "Registered · not enrolled" BEFORE "Previous students" (Vaibhav order)', async () => {
    const user = userEvent.setup();
    render(<NotInClassSection levelId="L" date="2026-10-04" previousStudents={PREV} />);
    await user.click(screen.getByRole('button', { name: /not in this class yet/i }));
    const registered = await screen.findByText(/Registered · not enrolled/i);
    const previous = screen.getByText(/Previous students/i);
    // Registered heading precedes the Previous heading in document order.
    expect(registered.compareDocumentPosition(previous) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows an all-enrolled empty state when there are no previous and no registered kids', async () => {
    mockFetch([]);
    const user = userEvent.setup();
    render(<NotInClassSection levelId="L" date="2026-10-04" previousStudents={[]} />);
    await user.click(screen.getByRole('button', { name: /not in this class yet/i }));
    expect(await screen.findByText(/Everyone eligible for this class is already enrolled/i)).toBeDefined();
  });
});
