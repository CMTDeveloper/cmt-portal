import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── CMT UI ────────────────────────────────────────────────────────────────────
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuAvatar: ({ name }: { name: string }) => <div data-testid="setu-avatar">{name}</div>,
}));

// ── Fetch ─────────────────────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { PendingJoinRequestsPanel } from '../pending-join-requests-panel';

const TWO_REQUESTS = {
  requests: [
    { token: 't1', requesterName: 'Asha Rao', requesterEmail: 'asha@example.com', matchedMid: 'm1', createdAt: '2026-06-20T00:00:00.000Z', status: 'pending' },
    { token: 't2', requesterEmail: 'kiran@example.com', requesterPhone: '+14165550000', matchedMid: 'm2', createdAt: '2026-06-21T00:00:00.000Z', status: 'pending' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PendingJoinRequestsPanel — empty / no requests', () => {
  it('renders nothing when the list is empty', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ requests: [] }) });
    const { container } = render(<PendingJoinRequestsPanel />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/setu/join-request', expect.anything());
    });
    // Panel suppressed entirely — no card chrome.
    expect(screen.queryByTestId('pending-join-requests')).toBeNull();
    // No stray text either.
    expect(container.textContent).toBe('');
  });

  it('renders nothing when the GET is not ok (non-manager / no session)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) });
    render(<PendingJoinRequestsPanel />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('pending-join-requests')).toBeNull();
  });
});

describe('PendingJoinRequestsPanel — populated (N=2)', () => {
  it('lists every open request with name/email and Approve/Decline', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => TWO_REQUESTS });
    render(<PendingJoinRequestsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('pending-join-requests')).toBeTruthy();
    });
    // Both rows render (N=2 case).
    expect(screen.getAllByTestId('join-request-row')).toHaveLength(2);
    // Name appears in both the avatar mock and the name line, so >0 is enough.
    expect(screen.getAllByText('Asha Rao').length).toBeGreaterThan(0);
    // Falls back to email when no name (appears as both avatar + name + sub-line).
    expect(screen.getAllByText('kiran@example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /approve/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /decline/i })).toHaveLength(2);
  });

  it('Approve POSTs to /approve with the token and refreshes', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => TWO_REQUESTS }) // initial list
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // approve t1
      .mockResolvedValueOnce({ ok: true, json: async () => ({ requests: TWO_REQUESTS.requests.slice(1) }) }); // refresh

    const user = userEvent.setup();
    render(<PendingJoinRequestsPanel />);
    await waitFor(() => expect(screen.getAllByTestId('join-request-row')).toHaveLength(2));

    await user.click(screen.getAllByRole('button', { name: /approve/i })[0]!);

    await waitFor(() => {
      const approveCall = fetchMock.mock.calls.find((c) => c[0] === '/api/setu/join-request/approve');
      expect(approveCall).toBeTruthy();
      const body = JSON.parse(approveCall?.[1]?.body as string) as { token: string };
      expect(body.token).toBe('t1');
    });
    expect(toastMock.success).toHaveBeenCalled();
    // After refresh only one row remains.
    await waitFor(() => expect(screen.getAllByTestId('join-request-row')).toHaveLength(1));
  });

  it('Decline POSTs to /decline with the token', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => TWO_REQUESTS })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ requests: TWO_REQUESTS.requests.slice(1) }) });

    const user = userEvent.setup();
    render(<PendingJoinRequestsPanel />);
    await waitFor(() => expect(screen.getAllByTestId('join-request-row')).toHaveLength(2));

    await user.click(screen.getAllByRole('button', { name: /decline/i })[0]!);

    await waitFor(() => {
      const declineCall = fetchMock.mock.calls.find((c) => c[0] === '/api/setu/join-request/decline');
      expect(declineCall).toBeTruthy();
      const body = JSON.parse(declineCall?.[1]?.body as string) as { token: string };
      expect(body.token).toBe('t1');
    });
  });

  it('shows a toast on a failed approve', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => TWO_REQUESTS })
      .mockResolvedValueOnce({ ok: false, status: 410, json: async () => ({ error: 'expired' }) });

    const user = userEvent.setup();
    render(<PendingJoinRequestsPanel />);
    await waitFor(() => expect(screen.getAllByTestId('join-request-row')).toHaveLength(2));

    await user.click(screen.getAllByRole('button', { name: /approve/i })[0]!);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });
});
