import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
