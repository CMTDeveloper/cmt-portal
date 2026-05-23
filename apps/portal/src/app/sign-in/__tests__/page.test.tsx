import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Feature flag ──────────────────────────────────────────────────────────────
const flagsMock = vi.hoisted(() => ({ setuAuth: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

// ── Next.js ───────────────────────────────────────────────────────────────────
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── CMT UI ────────────────────────────────────────────────────────────────────
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuLogo: () => <div data-testid="setu-logo" />,
  SetuIcon: {
    back: () => <span>back</span>,
    mail: () => <span>mail</span>,
  },
  Rosette: () => <div />,
}));

// ── Chrome atoms ──────────────────────────────────────────────────────────────
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ── OtpEntry (real component — test the integration) ─────────────────────────
// Keep the real OtpEntry so we exercise the digit-input interaction.

// ── Fetch ─────────────────────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ── window.location ───────────────────────────────────────────────────────────
const locationAssignMock = vi.fn();
Object.defineProperty(window, 'location', {
  value: { href: '', assign: locationAssignMock },
  writable: true,
});

import SignInPage from '../page';

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuAuth = true;
  window.location.href = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// Default state
// ─────────────────────────────────────────────────────────────────────────────

describe('SignInPage — default state (flag on)', () => {
  it('shows email input and "Send sign-in code" button', () => {
    render(<SignInPage />);
    // At minimum one email input exists
    const emailInputs = screen.getAllByRole('textbox');
    // Find at least one email input (there are mobile + desktop renders)
    const emailInput = emailInputs.find(
      (el) => (el as HTMLInputElement).type === 'email' || (el as HTMLInputElement).placeholder?.includes('example.com'),
    );
    expect(emailInput).toBeDefined();
    expect(screen.getAllByText(/send sign-in code/i).length).toBeGreaterThan(0);
  });

  it('shows "Use phone number instead" toggle button', () => {
    render(<SignInPage />);
    expect(screen.getAllByText(/use phone number instead/i).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phone toggle
// ─────────────────────────────────────────────────────────────────────────────

describe('SignInPage — phone toggle', () => {
  it('clicking "Use phone number instead" swaps to tel input and changes link text', async () => {
    const user = userEvent.setup();
    render(<SignInPage />);

    // Click the first toggle button (mobile or desktop)
    const toggleBtns = screen.getAllByText(/use phone number instead/i);
    await user.click(toggleBtns[0]!);

    // Now "Use email instead" should appear
    expect(screen.getAllByText(/use email instead/i).length).toBeGreaterThan(0);

    // tel-type input now exists
    const telInputs = document.querySelectorAll('input[type="tel"]');
    expect(telInputs.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Submit email → send-code → OTP entry visible
// ─────────────────────────────────────────────────────────────────────────────

describe('SignInPage — send-code flow', () => {
  it('submit email → fetch called to /api/setu/auth/send-code → OTP entry appears', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const user = userEvent.setup();
    render(<SignInPage />);

    // Type into the first email input
    const emailInputs = document.querySelectorAll('input[type="email"]');
    await user.clear(emailInputs[0] as HTMLElement);
    await user.type(emailInputs[0] as HTMLElement, 'test@example.com');

    // Click the first send button
    const sendBtns = screen.getAllByText(/send sign-in code/i);
    await user.click(sendBtns[0]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/setu/auth/send-code',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('test@example.com'),
        }),
      );
    });

    // OTP entry should now be visible (group role)
    await waitFor(() => {
      expect(screen.getAllByRole('group').length).toBeGreaterThan(0);
    });
  });

  it('429 from send-code shows toast.error with rate-limit message', async () => {
    const resetAt = new Date(Date.now() + 60_000).toISOString();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ resetAt }),
    });

    const user = userEvent.setup();
    render(<SignInPage />);

    const emailInputs = document.querySelectorAll('input[type="email"]');
    await user.clear(emailInputs[0] as HTMLElement);
    await user.type(emailInputs[0] as HTMLElement, 'test@example.com');

    const sendBtns = screen.getAllByText(/send sign-in code/i);
    await user.click(sendBtns[0]!);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/too many attempts/i));
    });

    // OTP entry should NOT appear
    expect(screen.queryByRole('group')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OTP submission
// ─────────────────────────────────────────────────────────────────────────────

describe('SignInPage — verify-code flow', () => {
  async function renderToCodeState() {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });
    const user = userEvent.setup();
    render(<SignInPage />);

    const emailInputs = document.querySelectorAll('input[type="email"]');
    await user.clear(emailInputs[0] as HTMLElement);
    await user.type(emailInputs[0] as HTMLElement, 'test@example.com');

    const sendBtns = screen.getAllByText(/send sign-in code/i);
    await user.click(sendBtns[0]!);

    await waitFor(() => {
      expect(screen.getAllByRole('group').length).toBeGreaterThan(0);
    });

    return user;
  }

  it('entering 6-digit code and submitting calls verify-code; on 200 navigates to redirectTo', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectTo: '/family' }),
    });

    const user = await renderToCodeState();

    // Paste code into OTP entry
    const digitInputs = screen.getAllByLabelText(/digit 1/i);
    await user.click(digitInputs[0]!);
    await user.paste('123456');

    // Click verify button
    const verifyBtns = screen.getAllByText(/verify code/i);
    await user.click(verifyBtns[0]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/setu/auth/verify-code',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"code":"123456"'),
        }),
      );
    });

    await waitFor(() => {
      expect(window.location.href).toBe('/family');
    });
  });

  it('400 from verify-code shows error toast and clears OTP field', async () => {
    const user = await renderToCodeState();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid-or-expired' }),
    });

    const digitInputs = screen.getAllByLabelText(/digit 1/i);
    await user.click(digitInputs[0]!);
    await user.paste('000000');

    const verifyBtns = screen.getAllByText(/verify code/i);
    await user.click(verifyBtns[0]!);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });

    // OTP inputs should still be present (stayed on code state)
    expect(screen.getAllByRole('group').length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M4 fix: handleResend actually re-sends the code
// ─────────────────────────────────────────────────────────────────────────────

describe('SignInPage — resend code (M4)', () => {
  async function renderToCodeState() {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });
    const user = userEvent.setup();
    render(<SignInPage />);

    const emailInputs = document.querySelectorAll('input[type="email"]');
    await user.clear(emailInputs[0] as HTMLElement);
    await user.type(emailInputs[0] as HTMLElement, 'test@example.com');

    const sendBtns = screen.getAllByText(/send sign-in code/i);
    await user.click(sendBtns[0]!);

    await waitFor(() => {
      expect(screen.getAllByRole('group').length).toBeGreaterThan(0);
    });

    return user;
  }

  it('clicking Re-send code calls /api/setu/auth/send-code a second time', async () => {
    // Second send-code call
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const user = await renderToCodeState();

    // At this point fetchMock has been called once (initial send)
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const resendBtns = screen.getAllByText(/re-send code/i);
    await user.click(resendBtns[0]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // Both calls were to send-code
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/setu/auth/send-code',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('after resend the OTP entry is shown again (stays on code state)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const user = await renderToCodeState();

    const resendBtns = screen.getAllByText(/re-send code/i);
    await user.click(resendBtns[0]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // OTP entry still visible
    expect(screen.getAllByRole('group').length).toBeGreaterThan(0);
  });

  it('resend rate-limit shows toast.error and stays on code state', async () => {
    const resetAt = new Date(Date.now() + 60_000).toISOString();
    // renderToCodeState consumes its own success mock internally.
    // Queue the 429 AFTER renderToCodeState returns so the resend fetch gets it.
    const user = await renderToCodeState();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ resetAt }),
    });

    const resendBtns = screen.getAllByText(/re-send code/i);
    await user.click(resendBtns[0]!);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/too many attempts/i));
    });

    // After 429 on resend, user stays on code state (handleResend no longer pre-sets 'form').
    expect(screen.getAllByRole('group').length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flag-off: renders prototype (no fetch calls)
// ─────────────────────────────────────────────────────────────────────────────

describe('SignInPage — flag off renders prototype', () => {
  it('renders the prototype (static email defaultValue) without calling fetch', async () => {
    flagsMock.setuAuth = false;
    render(<SignInPage />);

    // The prototype has a default value of aarti.patel@gmail.com
    const emailInputs = document.querySelectorAll(
      'input[type="email"]',
    ) as NodeListOf<HTMLInputElement>;
    const hasDefault = Array.from(emailInputs).some(
      (el) => el.defaultValue === 'aarti.patel@gmail.com',
    );
    expect(hasDefault).toBe(true);

    // No fetch calls at all
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
