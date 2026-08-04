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
import type { JoinRequestListItem } from '@/features/setu/join-request';

const TWO_REQUESTS: JoinRequestListItem[] = [
  { token: 't1', requesterName: 'Asha Rao', requesterEmail: 'asha@example.com', matchedMid: 'm1', createdAt: '2026-06-20T00:00:00.000Z', status: 'pending' },
  { token: 't2', requesterEmail: 'kiran@example.com', requesterPhone: '+14165550000', matchedMid: 'm2', createdAt: '2026-06-21T00:00:00.000Z', status: 'pending' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PendingJoinRequestsPanel — empty / no requests', () => {
  it('renders nothing when the list is empty', () => {
    const { container } = render(<PendingJoinRequestsPanel initialRequests={[]} />);
    expect(screen.queryByTestId('pending-join-requests')).toBeNull();
    expect(container.textContent).toBe('');
  });

  /**
   * 🔴 The regression this whole change exists to prevent.
   *
   * The panel used to fetch its own list from a mount effect, and /family
   * renders it TWICE (compact mobile + desktop). Measured on deployed preview,
   * one dashboard load fired FOUR identical GETs, the slowest finishing 930ms
   * in - on the page every family lands on, for data the server already had.
   *
   * Asserting "renders correctly" cannot catch a regression here, because
   * re-adding the effect would still render correctly. Only counting the
   * requests can.
   */
  it('issues NO network request on mount — the server already supplied the list', async () => {
    render(<PendingJoinRequestsPanel initialRequests={TWO_REQUESTS} />);
    await waitFor(() => expect(screen.getAllByTestId('join-request-row')).toHaveLength(2));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders both copies from ONE server read without either fetching', async () => {
    // The real dual-tree shape: /family mounts a compact and a full instance.
    render(
      <>
        <PendingJoinRequestsPanel compact initialRequests={TWO_REQUESTS} />
        <PendingJoinRequestsPanel initialRequests={TWO_REQUESTS} />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId('join-request-row')).toHaveLength(4));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('PendingJoinRequestsPanel — populated (N=2)', () => {
  it('lists every open request with name/email and Approve/Decline', () => {
    render(<PendingJoinRequestsPanel initialRequests={TWO_REQUESTS} />);

    expect(screen.getByTestId('pending-join-requests')).toBeTruthy();
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // approve t1
      .mockResolvedValueOnce({ ok: true, json: async () => ({ requests: TWO_REQUESTS.slice(1) }) }); // refresh

    const user = userEvent.setup();
    render(<PendingJoinRequestsPanel initialRequests={TWO_REQUESTS} />);
    expect(screen.getAllByTestId('join-request-row')).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: /approve/i })[0]!);

    await waitFor(() => {
      const approveCall = fetchMock.mock.calls.find((c) => c[0] === '/api/setu/join-request/approve');
      expect(approveCall).toBeTruthy();
      const body = JSON.parse(approveCall?.[1]?.body as string) as { token: string };
      expect(body.token).toBe('t1');
    });
    expect(toastMock.success).toHaveBeenCalled();
    // The re-read after acting IS still expected — only the mount fetch went.
    await waitFor(() => expect(screen.getAllByTestId('join-request-row')).toHaveLength(1));
  });

  it('Decline POSTs to /decline with the token', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ requests: TWO_REQUESTS.slice(1) }) });

    const user = userEvent.setup();
    render(<PendingJoinRequestsPanel initialRequests={TWO_REQUESTS} />);
    expect(screen.getAllByTestId('join-request-row')).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: /decline/i })[0]!);

    await waitFor(() => {
      const declineCall = fetchMock.mock.calls.find((c) => c[0] === '/api/setu/join-request/decline');
      expect(declineCall).toBeTruthy();
      const body = JSON.parse(declineCall?.[1]?.body as string) as { token: string };
      expect(body.token).toBe('t1');
    });
  });

  it('shows a toast on a failed approve', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 410, json: async () => ({ error: 'expired' }) });

    const user = userEvent.setup();
    render(<PendingJoinRequestsPanel initialRequests={TWO_REQUESTS} />);
    expect(screen.getAllByTestId('join-request-row')).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: /approve/i })[0]!);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });

  /**
   * A failed re-read must not blank a panel that is still showing real rows.
   * The old code set `loaded` and left the list empty on a non-ok response,
   * which was harmless when the only caller was the mount fetch; now that the
   * only fetch is the post-action re-read, swallowing it into an empty list
   * would erase rows the manager can still act on.
   */
  it('keeps the remaining rows when the post-action re-read fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // decline succeeds
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }); // re-read fails

    const user = userEvent.setup();
    render(<PendingJoinRequestsPanel initialRequests={TWO_REQUESTS} />);

    await user.click(screen.getAllByRole('button', { name: /decline/i })[0]!);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => c[0] === '/api/setu/join-request')).toBe(true);
    });
    expect(screen.getAllByTestId('join-request-row')).toHaveLength(2);
  });
});
