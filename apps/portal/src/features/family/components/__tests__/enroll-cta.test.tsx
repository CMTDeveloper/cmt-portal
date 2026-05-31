import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockPush = vi.fn();

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuIcon: { check: () => null, edit: () => null, back: () => null },
  SetuAvatar: () => null,
  SetuLogo: () => null,
}));

import { EnrollCta } from '../enroll-cta';

const OID = 'bv-brampton-fall-2026';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  mockPush.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

describe('EnrollCta', () => {
  it('donations enabled: navigates to donateUrl and does not re-enable button', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ eid: 'CMT-AAAA-bv-brampton-fall-2026', donateUrl: '/family/donate?eid=CMT-AAAA-bv-brampton-fall-2026' }),
    } as Response);

    render(<EnrollCta oid={OID} donationsEnabled={true}/>);
    await user.click(screen.getByRole('button', { name: /enroll/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/family/donate?eid=CMT-AAAA-bv-brampton-fall-2026'));
    expect(toastMock.success).toHaveBeenCalledWith('Enrolled! Continuing to donation.');
    // Button stays disabled (pending not cleared on success)
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('donations disabled: shows enrolled state and does not navigate', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ eid: 'CMT-AAAA-bv-brampton-fall-2026', donateUrl: '/family/donate?eid=CMT-AAAA-bv-brampton-fall-2026' }),
    } as Response);

    render(<EnrollCta oid={OID} donationsEnabled={false}/>);
    await user.click(screen.getByRole('button', { name: /enroll/i }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Your family is enrolled!'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText(/donation coming soon/i)).toBeTruthy();
  });

  it('on 401: redirects to sign-in with safeFrom param', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'no-session' }),
    } as Response);

    render(<EnrollCta oid={OID} donationsEnabled={false}/>);
    await user.click(screen.getByRole('button', { name: /enroll/i }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('/sign-in?from='),
      ),
    );
    // The from param must be URL-encoded /family/enroll
    expect(mockPush).toHaveBeenCalledWith(
      '/sign-in?from=%2Ffamily%2Fenroll',
    );
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('POSTs the oid (not pid) in the request body', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ eid: 'x', donateUrl: '/family/donate?eid=x' }),
    } as Response);

    render(<EnrollCta oid={OID} donationsEnabled={false}/>);
    await user.click(screen.getByRole('button', { name: /enroll/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ oid: OID });
  });

  it('on offering-disabled: shows correct toast and re-enables button', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: 'offering-disabled' }),
    } as Response);

    render(<EnrollCta oid={OID} donationsEnabled={false}/>);
    await user.click(screen.getByRole('button', { name: /enroll/i }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringContaining('no longer enrolling'),
      ),
    );
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('on offering-expired: shows correct toast', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: 'offering-expired' }),
    } as Response);

    render(<EnrollCta oid={OID} donationsEnabled={false}/>);
    await user.click(screen.getByRole('button', { name: /enroll/i }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringContaining('has ended'),
      ),
    );
  });

  it('on offering-not-found: shows correct toast', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'offering-not-found' }),
    } as Response);

    render(<EnrollCta oid={OID} donationsEnabled={false}/>);
    await user.click(screen.getByRole('button', { name: /enroll/i }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringContaining('no longer available'),
      ),
    );
  });

  it('on program-not-available: shows correct toast', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: 'program-not-available' }),
    } as Response);

    render(<EnrollCta oid={OID} donationsEnabled={false}/>);
    await user.click(screen.getByRole('button', { name: /enroll/i }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringContaining('not available right now'),
      ),
    );
  });

  it('double-click: POST called only once (button disabled after first click)', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ eid: 'x', donateUrl: '/family/donate?eid=x' }),
    } as Response);

    render(<EnrollCta oid={OID} donationsEnabled={true}/>);
    const btn = screen.getByRole('button', { name: /enroll/i });

    // Rapid double-click
    await user.dblClick(btn);

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
