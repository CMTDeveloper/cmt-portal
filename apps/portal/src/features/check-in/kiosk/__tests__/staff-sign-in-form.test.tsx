import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Controllable searchParams - default empty; tests set `.value` before render.
const searchParamsMock = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(searchParamsMock.value),
}));

// ── CMT UI ────────────────────────────────────────────────────────────────────
vi.mock('@cmt/ui', () => ({
  SetuLogo: () => <div data-testid="setu-logo" />,
}));

// ── Chrome atoms ──────────────────────────────────────────────────────────────
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ── Fetch ─────────────────────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ── window.location ───────────────────────────────────────────────────────────
const locationAssignMock = vi.fn();
Object.defineProperty(window, 'location', {
  value: { href: '', assign: locationAssignMock, search: '' },
  writable: true,
});

import { StaffSignInForm } from '../staff-sign-in-form';

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsMock.value = '';
});

describe('StaffSignInForm', () => {
  it('renders the username field, the password field, and a "Staff sign-in" heading', () => {
    render(<StaffSignInForm />);
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /staff sign-in/i })).toBeInTheDocument();
  });

  it('successful submit navigates to redirectTo via window.location.assign', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ redirectTo: '/check-in' }),
    });

    const user = userEvent.setup();
    render(<StaffSignInForm />);

    await user.type(screen.getByLabelText(/username/i), 'sevak');
    await user.type(screen.getByLabelText(/password/i), 'the-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/setu/auth/kiosk-sign-in',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await waitFor(() => {
      expect(locationAssignMock).toHaveBeenCalledWith('/check-in');
    });
  });

  it('401 shows an inline "Wrong username or password" error and does NOT navigate', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid-credentials' }),
    });

    const user = userEvent.setup();
    render(<StaffSignInForm />);

    await user.type(screen.getByLabelText(/username/i), 'sevak');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/wrong username or password/i);
    expect(locationAssignMock).not.toHaveBeenCalled();
  });

  it('429 shows an inline "too many attempts" error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'too-many-requests' }),
    });

    const user = userEvent.setup();
    render(<StaffSignInForm />);

    await user.type(screen.getByLabelText(/username/i), 'sevak');
    await user.type(screen.getByLabelText(/password/i), 'pw');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
    expect(locationAssignMock).not.toHaveBeenCalled();
  });

  it('shows the expiry banner when ?error=session-expired', () => {
    searchParamsMock.value = 'error=session-expired';
    render(<StaffSignInForm />);
    expect(screen.getByRole('status')).toHaveTextContent(/your session expired\. please sign in again\./i);
  });

  it('shows the unauthorized banner when ?error=unauthorized', () => {
    searchParamsMock.value = 'error=unauthorized';
    render(<StaffSignInForm />);
    expect(screen.getByRole('status')).toHaveTextContent(/please sign in to use the kiosk\./i);
  });

  it('shows no banner when error is absent', () => {
    render(<StaffSignInForm />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('forwards a safe ?from= to the POST url', async () => {
    searchParamsMock.value = 'from=/check-in/guest';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ redirectTo: '/check-in/guest' }),
    });

    const user = userEvent.setup();
    render(<StaffSignInForm />);

    // jsdom drops chars beyond the first for validated inputs; use fireEvent.change.
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'sevak' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw' } });
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/setu/auth/kiosk-sign-in?from=%2Fcheck-in%2Fguest',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('drops an unsafe ?from= (protocol-relative) from the POST url', async () => {
    searchParamsMock.value = 'from=//evil.com';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ redirectTo: '/check-in' }),
    });

    const user = userEvent.setup();
    render(<StaffSignInForm />);

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'sevak' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw' } });
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/setu/auth/kiosk-sign-in',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
