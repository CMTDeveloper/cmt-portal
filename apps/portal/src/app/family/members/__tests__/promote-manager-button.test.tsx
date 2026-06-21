import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuIcon: { shield: () => <span>shield</span> },
}));

import { PromoteManagerButton } from '../promote-manager-button';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PromoteManagerButton (desktop)', () => {
  it('requires a confirm step before PATCHing', async () => {
    const user = userEvent.setup();
    render(<PromoteManagerButton mid="CMT-AB12CD34-02" name="Priya" variant="desktop" />);

    // First click only reveals the confirm step — no network call yet.
    await user.click(screen.getByRole('button', { name: /make manager/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
  });

  it('PATCHes { manager: true } and refreshes on confirm', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const user = userEvent.setup();
    render(<PromoteManagerButton mid="CMT-AB12CD34-02" name="Priya" variant="desktop" />);

    await user.click(screen.getByRole('button', { name: /make manager/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/setu/members/CMT-AB12CD34-02');
    expect(init).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse((init as { body: string }).body)).toEqual({ manager: true });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledOnce());
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('shows an error toast and does not refresh on a failed PATCH', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'last-manager' }) });
    const user = userEvent.setup();
    render(<PromoteManagerButton mid="CMT-AB12CD34-02" name="Priya" variant="desktop" />);

    await user.click(screen.getByRole('button', { name: /make manager/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('last-manager'));
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('cancel dismisses the confirm step without calling the API', async () => {
    const user = userEvent.setup();
    render(<PromoteManagerButton mid="CMT-AB12CD34-02" name="Priya" variant="desktop" />);

    await user.click(screen.getByRole('button', { name: /make manager/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.getByRole('button', { name: /make manager/i })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('PromoteManagerButton (mobile)', () => {
  it('PATCHes { manager: true } after the inline confirm', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const user = userEvent.setup();
    render(<PromoteManagerButton mid="CMT-AB12CD34-03" name="Arjun" variant="mobile" />);

    await user.click(screen.getByRole('button', { name: /make manager/i }));
    // Mobile confirm button is labelled with the member name.
    await user.click(screen.getByRole('button', { name: /make arjun a manager/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/setu/members/CMT-AB12CD34-03');
    expect(JSON.parse((init as { body: string }).body)).toEqual({ manager: true });
  });
});
