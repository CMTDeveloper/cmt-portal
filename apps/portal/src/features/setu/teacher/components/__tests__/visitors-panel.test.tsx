import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisitorsPanel } from '../visitors-panel';

vi.mock('@cmt/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const VIEW = {
  levelId: 'L', levelName: 'Level 1', ageLabel: 'Grade 1', location: 'Brampton', date: '2026-01-04',
  doorVisitors: [
    { name: 'Arjun X', grade: '1', parentEmail: 'mom@x.com', parentName: 'Mom', phone: '416', alreadyConfirmed: false },
    { name: 'Ravi Y', grade: '1', parentEmail: 'dad@y.com', parentName: null, phone: null, alreadyConfirmed: true },
  ],
  confirmed: [{ mid: 'F-02', fid: 'CMT-F', firstName: 'Sita', lastName: 'Z', status: 'present' }],
};

function mockGetView() {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ view: VIEW }) });
}

describe('VisitorsPanel', () => {
  it('loads and shows door visitors, marking already-confirmed ones', async () => {
    mockGetView();
    render(<VisitorsPanel levelId="L" levelName="Level 1" date="2026-01-04" />);
    expect(await screen.findByText('Arjun X')).toBeInTheDocument();
    expect(screen.getByText('Ravi Y')).toBeInTheDocument();
    expect(screen.getByText('Sita Z')).toBeInTheDocument(); // confirmed list
  });

  it('quick-adds a walk-in with name only and refetches', async () => {
    mockGetView(); // initial load
    render(<VisitorsPanel levelId="L" levelName="Level 1" date="2026-01-04" />);
    await screen.findByText('Arjun X');

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true, claimable: false }) }); // POST
    mockGetView(); // refetch after add

    await userEvent.type(screen.getByPlaceholderText(/first name/i), 'Walk');
    await userEvent.click(screen.getByRole('button', { name: /add visitor/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1]!.body as string)).toMatchObject({ levelId: 'L', date: '2026-01-04', firstName: 'Walk' });
    });
  });

  it('renders Grade as a select whose options include the canonical grades', async () => {
    mockGetView();
    render(<VisitorsPanel levelId="L" levelName="Level 1" date="2026-01-04" />);
    await screen.findByText('Arjun X');

    // EXACT name, not /grade/i: the door list now has its own "Filter by grade"
    // combobox, and a loose regex matches both and makes getByRole throw.
    const gradeSelect = screen.getByRole('combobox', { name: 'Grade' });
    expect(gradeSelect.tagName).toBe('SELECT');
    expect(within(gradeSelect).getByRole('option', { name: 'Grade 1' })).toBeInTheDocument();
    expect(within(gradeSelect).getByRole('option', { name: 'SK' })).toBeInTheDocument();
    // blank first option keeps the field optional
    expect(within(gradeSelect).getByRole('option', { name: /grade \(optional\)/i })).toBeInTheDocument();
  });

  // ── Grade filter (P2 Task 7) ───────────────────────────────────────────────
  // A level can hold more than one grade (its gradeBand is a range), which is the
  // whole reason this filter exists - so the fixture needs TWO grades. A
  // single-grade fixture would pass whether or not the filter did anything.
  const MIXED_VIEW = {
    ...VIEW,
    doorVisitors: [
      { name: 'Arjun X', grade: '1', parentEmail: 'mom@x.com', parentName: 'Mom', phone: '416', alreadyConfirmed: false },
      { name: 'Ravi Y', grade: '2', parentEmail: 'dad@y.com', parentName: null, phone: null, alreadyConfirmed: true },
    ],
  };
  function mockMixedView() {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ view: MIXED_VIEW }) });
  }

  it('filters the door list by grade', async () => {
    mockMixedView();
    render(<VisitorsPanel levelId="L" levelName="Level 1" date="2026-01-04" />);
    await screen.findByText('Arjun X');
    expect(screen.getByText('Ravi Y')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by grade' }), '1');
    expect(screen.getByText('Arjun X')).toBeInTheDocument();
    expect(screen.queryByText('Ravi Y')).not.toBeInTheDocument();
  });

  // The confirmed list carries NO grade (ConfirmedRow is mid/fid/name/status), so
  // it cannot be filtered even in principle. Pinned so nobody later "fixes" the
  // inconsistency by inventing a grade for it.
  it('leaves the already-marked-present list alone, which has no grade to filter on', async () => {
    mockMixedView();
    render(<VisitorsPanel levelId="L" levelName="Level 1" date="2026-01-04" />);
    await screen.findByText('Arjun X');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by grade' }), '1');
    expect(screen.getByText('Sita Z')).toBeInTheDocument();
  });

  it('offers only the grades actually checked in, plus All', async () => {
    mockMixedView();
    render(<VisitorsPanel levelId="L" levelName="Level 1" date="2026-01-04" />);
    await screen.findByText('Arjun X');
    const filter = screen.getByRole('combobox', { name: 'Filter by grade' });
    expect(within(filter).getByRole('option', { name: 'Grade 1' })).toBeInTheDocument();
    expect(within(filter).getByRole('option', { name: 'Grade 2' })).toBeInTheDocument();
    // Grade 5 is a canonical grade but nobody here is in it - offering it would
    // let a teacher filter to a guaranteed-empty list.
    expect(within(filter).queryByRole('option', { name: 'Grade 5' })).not.toBeInTheDocument();
  });

  // The stuck state, and the reason the filtered-empty branch exists at all.
  // Filter to grade 2, then a refetch returns only grade-1 guests: gradeFilter is
  // still '2', so the list is empty - and because the select hides itself when
  // there is only one grade left, the control that would clear it is GONE. Without
  // an escape hatch the teacher sees an empty class with no way back, and the
  // generic "no door guests match this class" would send them to check the door
  // tablet for a problem that does not exist.
  it('offers a way out when a refetch leaves the chosen grade empty', async () => {
    mockMixedView();
    render(<VisitorsPanel levelId="L" levelName="Level 1" date="2026-01-04" />);
    await screen.findByText('Arjun X');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by grade' }), '2');
    expect(screen.queryByText('Arjun X')).not.toBeInTheDocument();

    // Add a visitor, which POSTs and refetches - the refetch has grade 1 only.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ fid: 'CMT-N', childMid: 'CMT-N-02', createdFamily: true, claimable: false }) });
    mockGetView(); // VIEW: both guests are grade '1'
    await userEvent.type(screen.getByPlaceholderText(/first name/i), 'Walk');
    await userEvent.click(screen.getByRole('button', { name: /add visitor/i }));

    // The filter select is now hidden (one grade), so the escape must be inline.
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Filter by grade' })).not.toBeInTheDocument());
    expect(screen.getByText(/No Grade 2 guests checked in at the door today/i)).toBeInTheDocument();
    expect(screen.queryByText(/No door guests match this class for/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /show all 2/i }));
    expect(screen.getByText('Arjun X')).toBeInTheDocument();
  });

  it('hides the filter when every door guest is in the same grade', async () => {
    mockGetView(); // VIEW: both visitors are grade '1'
    render(<VisitorsPanel levelId="L" levelName="Level 1" date="2026-01-04" />);
    await screen.findByText('Arjun X');
    expect(screen.queryByRole('combobox', { name: 'Filter by grade' })).not.toBeInTheDocument();
  });

  it('blocks an empty-name quick-add', async () => {
    mockGetView();
    const { toast } = await import('@cmt/ui');
    render(<VisitorsPanel levelId="L" levelName="Level 1" date="2026-01-04" />);
    await screen.findByText('Arjun X');
    await userEvent.click(screen.getByRole('button', { name: /add visitor/i }));
    expect(toast.error).toHaveBeenCalled();
    // no POST fired
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });
});
