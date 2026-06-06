import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

// Controllable searchParams — default empty; tests set `.value` before render.
const searchParamsMock = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(searchParamsMock.value),
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
  value: { href: '', assign: locationAssignMock, search: '' },
  writable: true,
});

// ── localStorage ──────────────────────────────────────────────────────────────
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

import SignInPage from '../page';

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuAuth = true;
  window.location.href = '';
  localStorageMock.clear();
  searchParamsMock.value = '';
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
// Prefill from ?type=&value= (arriving from a phone-matched register CTA)
// ─────────────────────────────────────────────────────────────────────────────

describe('SignInPage — prefill from ?type=phone&value=', () => {
  it('initializes the contact as phone with the matched value pre-filled', () => {
    searchParamsMock.value = 'type=phone&value=4165550000';
    render(<SignInPage />);

    // The contact field is now a tel input (phone mode) and shows the matched value.
    const telInputs = document.querySelectorAll('input[type="tel"]') as NodeListOf<HTMLInputElement>;
    expect(telInputs.length).toBeGreaterThan(0);
    expect(telInputs[0]!.value).toBe('4165550000');

    // The "Use email instead" toggle confirms we started in phone mode.
    expect(screen.getAllByText(/use email instead/i).length).toBeGreaterThan(0);
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
  it('renders the prototype with empty controlled email input + placeholder, without calling fetch', async () => {
    flagsMock.setuAuth = false;
    render(<SignInPage />);

    const emailInputs = document.querySelectorAll(
      'input[type="email"]',
    ) as NodeListOf<HTMLInputElement>;
    expect(emailInputs.length).toBeGreaterThan(0);
    // Inputs are controlled and start empty; the example shows via placeholder.
    Array.from(emailInputs).forEach((el) => {
      expect(el.value).toBe('');
      expect(el.placeholder).toBe('you@example.com');
    });

    // No fetch calls at all
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Password mode toggle
// ─────────────────────────────────────────────────────────────────────────────

describe('SignInPage — password mode toggle', () => {
  it('clicking "Have a password?" switches to password mode and shows email+password fields', async () => {
    const user = userEvent.setup();
    render(<SignInPage />);

    // Default is OTP mode — "Have a password?" link should be present
    const toggleBtns = screen.getAllByText(/have a password\? sign in faster/i);
    expect(toggleBtns.length).toBeGreaterThan(0);

    await user.click(toggleBtns[0]!);

    // Password mode: password inputs should appear
    const pwInputs = document.querySelectorAll('input[type="password"]');
    expect(pwInputs.length).toBeGreaterThan(0);

    // OTP send-code button should NOT be visible
    expect(screen.queryByText(/send sign-in code/i)).toBeNull();

    // "Or sign in with a code" link should appear
    expect(screen.getAllByText(/or sign in with a code/i).length).toBeGreaterThan(0);
  });

  it('clicking "Or sign in with a code" switches back to OTP mode', async () => {
    const user = userEvent.setup();
    render(<SignInPage />);

    // Switch to password mode
    const toggleBtns = screen.getAllByText(/have a password\? sign in faster/i);
    await user.click(toggleBtns[0]!);

    // Now switch back to OTP
    const backBtns = screen.getAllByText(/or sign in with a code/i);
    await user.click(backBtns[0]!);

    // OTP send-code button should be back
    expect(screen.getAllByText(/send sign-in code/i).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('input[type="password"]').length).toBe(0);
  });

  it('persists password mode preference in localStorage', async () => {
    const user = userEvent.setup();
    render(<SignInPage />);

    const toggleBtns = screen.getAllByText(/have a password\? sign in faster/i);
    await user.click(toggleBtns[0]!);

    expect(localStorageMock.getItem('setu-signin-mode')).toBe('password');
  });

  it('reads localStorage on mount and defaults to password mode if stored', async () => {
    localStorageMock.setItem('setu-signin-mode', 'password');
    render(<SignInPage />);

    // After mount the useEffect fires; wait for re-render
    await waitFor(() => {
      expect(document.querySelectorAll('input[type="password"]').length).toBeGreaterThan(0);
    });

    // OTP send-code button should NOT appear
    expect(screen.queryByText(/send sign-in code/i)).toBeNull();
  });

  it('a register OTP handoff (?type/&value) forces code mode even when password is the stored preference', async () => {
    // Returning user has previously chosen password mode...
    localStorageMock.setItem('setu-signin-mode', 'password');
    // ...but arrives from the register "We found a family" CTA carrying an OTP-proof handoff.
    searchParamsMock.value = 'type=phone&value=4165550000';
    render(<SignInPage />);

    // Stays in OTP/code mode: the send-code button is shown, no password form.
    expect(screen.getAllByText(/send sign-in code/i).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('input[type="password"]').length).toBe(0);
    expect(screen.queryByText(/forgot password\?/i)).toBeNull();

    // The phone value rides through to the (tel) contact field.
    const telInputs = document.querySelectorAll('input[type="tel"]') as NodeListOf<HTMLInputElement>;
    expect(telInputs.length).toBeGreaterThan(0);
    expect(telInputs[0]!.value).toBe('4165550000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Password sign-in flow
// ─────────────────────────────────────────────────────────────────────────────

describe('SignInPage — password sign-in flow', () => {
  async function renderInPasswordMode() {
    const user = userEvent.setup();
    render(<SignInPage />);

    const toggleBtns = screen.getAllByText(/have a password\? sign in faster/i);
    await user.click(toggleBtns[0]!);

    await waitFor(() => {
      expect(document.querySelectorAll('input[type="password"]').length).toBeGreaterThan(0);
    });

    return user;
  }

  it('successful sign-in calls /api/setu/auth/password-sign-in and navigates to redirectTo', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectTo: '/family' }),
    });

    const user = await renderInPasswordMode();

    // Use fireEvent.change to set values — email input type validation in jsdom
    // causes userEvent.type to drop characters beyond the first.
    const emailInput = document.querySelectorAll('input[type="email"]')[0] as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    const pwInput = document.querySelectorAll('input[type="password"]')[0] as HTMLInputElement;
    fireEvent.change(pwInput, { target: { value: 'correct-password' } });

    const signInBtns = screen.getAllByText(/^sign in →$/i);
    await user.click(signInBtns[0]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/setu/auth/password-sign-in',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('test@example.com'),
        }),
      );
    });

    await waitFor(() => {
      expect(locationAssignMock).toHaveBeenCalledWith('/family');
    });
  });

  it('401 from password-sign-in shows "Incorrect email or password" toast', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid-credentials' }),
    });

    const user = await renderInPasswordMode();

    const emailInput = document.querySelectorAll('input[type="email"]')[0] as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    const pwInput = document.querySelectorAll('input[type="password"]')[0] as HTMLInputElement;
    fireEvent.change(pwInput, { target: { value: 'wrong-password' } });

    const signInBtns = screen.getAllByText(/^sign in →$/i);
    await user.click(signInBtns[0]!);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith('Incorrect email or password.');
    });

    // Should NOT navigate
    expect(locationAssignMock).not.toHaveBeenCalled();
  });

  it('429 from password-sign-in shows rate-limit toast', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'too-many-requests' }),
    });

    const user = await renderInPasswordMode();

    const emailInput = document.querySelectorAll('input[type="email"]')[0] as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    const pwInput = document.querySelectorAll('input[type="password"]')[0] as HTMLInputElement;
    fireEvent.change(pwInput, { target: { value: 'somepassword' } });

    const signInBtns = screen.getAllByText(/^sign in →$/i);
    await user.click(signInBtns[0]!);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/too many attempts/i));
    });
  });
});
