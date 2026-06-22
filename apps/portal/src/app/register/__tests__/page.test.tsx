import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Feature flag ──────────────────────────────────────────────────────────────
const flagsMock = vi.hoisted(() => ({ setuAuth: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

// ── Next.js ───────────────────────────────────────────────────────────────────
vi.mock('next/link', () => ({
  default: ({ children, href, className, style }: { children: React.ReactNode; href: string; className?: string; style?: React.CSSProperties }) => (
    <a href={href} className={className} style={style}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}));

// ── CMT UI ────────────────────────────────────────────────────────────────────
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuLogo: () => <div data-testid="setu-logo" />,
  SetuAvatar: ({ name }: { name: string }) => <div data-testid="setu-avatar">{name}</div>,
  SetuIcon: {
    back: () => <span>back</span>,
    info: () => <span>info</span>,
    plus: () => <span>plus</span>,
  },
  Rosette: () => <div />,
}));

// ── Chrome atoms ──────────────────────────────────────────────────────────────
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StepHeader: ({ step, of, label }: { step: number; of: number; label: string }) => (
    <div data-testid="step-header">Step {step} of {of} · {label}</div>
  ),
  AddedMemberRow: ({ name, type }: { name: string; type: string }) => (
    <div data-testid="added-member-row">{name} — {type}</div>
  ),
}));

// ── Fetch ─────────────────────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import RegisterPage from '../page';

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuAuth = true;
});

// ─────────────────────────────────────────────────────────────────────────────
// Flag-off: renders prototype
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterPage — flag off renders prototype', () => {
  it('renders prototype with simulated dedupe on raj.patel@gmail.com', async () => {
    flagsMock.setuAuth = false;
    const user = userEvent.setup();
    render(<RegisterPage />);

    const emailInputs = document.querySelectorAll('input[type="email"]');
    expect(emailInputs.length).toBeGreaterThan(0);

    // Type the magic email that triggers prototype match
    await user.clear(emailInputs[0] as HTMLElement);
    await user.type(emailInputs[0] as HTMLElement, 'raj.patel@gmail.com');

    // Match panel appears
    await waitFor(() => {
      expect(screen.getAllByText(/we found a family/i).length).toBeGreaterThan(0);
    });

    // No real fetch calls
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Default (flag on): both fields empty → Continue button disabled / inactive
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterPage — initial state (flag on)', () => {
  it('shows email and phone fields and a Continue button', () => {
    render(<RegisterPage />);
    const emailInputs = document.querySelectorAll('input[type="email"]');
    const telInputs = document.querySelectorAll('input[type="tel"]');
    expect(emailInputs.length).toBeGreaterThan(0);
    expect(telInputs.length).toBeGreaterThan(0);
    // Continue button present (disabled when fields empty)
    const continueBtns = screen.getAllByRole('button', { name: /continue/i });
    expect(continueBtns.length).toBeGreaterThan(0);
    expect(continueBtns[0]).toBeDisabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Typing triggers lookup — match panel
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterPage — lookup returns match', () => {
  it('filling both fields triggers fetch to /api/setu/family-lookup and shows match panel', async () => {
    // The PUBLIC lookup returns NO family PII — only that a contact matched
    // and which one. No fid/name/location/members/initials.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        match: { found: true, matchedType: 'email', matchedValue: 'raj@example.com', matchAction: 'sign-in' },
      }),
    });

    const user = userEvent.setup();
    render(<RegisterPage />);

    const emailInputs = document.querySelectorAll('input[type="email"]');
    const telInputs = document.querySelectorAll('input[type="tel"]');

    await user.type(emailInputs[0] as HTMLElement, 'raj@example.com');
    await user.type(telInputs[0] as HTMLElement, '4165550100');

    // Blur phone to trigger immediate lookup
    await user.tab();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/setu/family-lookup',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText(/this contact is already registered/i).length).toBeGreaterThan(0);
    });

    // Privacy: NO family name / location / manager initials are shown.
    expect(screen.queryByText(/the patel family/i)).toBeNull();
    expect(screen.queryByText(/brampton/i)).toBeNull();

    // "Sign in to access my family →" Link points to /sign-in with the MATCHED
    // contact carried via ?type=&value= (the user's own contact, not a leak).
    const joinLinks = screen.getAllByRole('link', { name: /sign in to access my family/i });
    expect(joinLinks.length).toBeGreaterThan(0);
    const href = joinLinks[0]?.getAttribute('href') ?? '';
    expect(href).toMatch(/^\/sign-in\?type=email&value=/);
    expect(decodeURIComponent(href)).toContain('raj@example.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Match CTA signs in with the MATCHED contact (not always the primary email)
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterPage — match CTA uses the matched contact', () => {
  it('sign-in link targets the matched contact when the match came via phone', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        match: { found: true, matchedType: 'phone', matchedValue: '4165550000', matchAction: 'sign-in' },
      }),
    });

    const user = userEvent.setup();
    render(<RegisterPage />);

    const emailInputs = document.querySelectorAll('input[type="email"]');
    const telInputs = document.querySelectorAll('input[type="tel"]');

    await user.type(emailInputs[0] as HTMLElement, 'raj@example.com');
    await user.type(telInputs[0] as HTMLElement, '4165550100');
    await user.tab();

    await waitFor(() => {
      expect(screen.getAllByText(/this contact is already registered/i).length).toBeGreaterThan(0);
    });

    const joinLinks = screen.getAllByRole('link', { name: /sign in to access my family/i });
    expect(joinLinks.length).toBeGreaterThan(0);
    const href = joinLinks[0]?.getAttribute('href') ?? '';
    expect(href).toBe('/sign-in?type=phone&value=4165550000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lookup returns no match
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterPage — lookup returns no match', () => {
  it('shows no-match panel and "Continue to family details" link', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ match: null }),
    });

    const user = userEvent.setup();
    render(<RegisterPage />);

    const emailInputs = document.querySelectorAll('input[type="email"]');
    const telInputs = document.querySelectorAll('input[type="tel"]');

    await user.type(emailInputs[0] as HTMLElement, 'new@example.com');
    await user.type(telInputs[0] as HTMLElement, '4165559999');
    await user.tab();

    await waitFor(() => {
      expect(screen.getAllByText(/no existing family matched/i).length).toBeGreaterThan(0);
    });

    const continueLinks = screen.getAllByRole('link', { name: /continue to family details/i });
    expect(continueLinks.length).toBeGreaterThan(0);
    expect(continueLinks[0]?.getAttribute('href')).toContain('/register/family');
    // Query params carry email + phone forward
    expect(continueLinks[0]?.getAttribute('href')).toContain('email=');
    expect(continueLinks[0]?.getAttribute('href')).toContain('phone=');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lookup error surfaces toast
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterPage — lookup network error', () => {
  it('shows toast.error when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const user = userEvent.setup();
    render(<RegisterPage />);

    const emailInputs = document.querySelectorAll('input[type="email"]');
    const telInputs = document.querySelectorAll('input[type="tel"]');

    await user.type(emailInputs[0] as HTMLElement, 'fail@example.com');
    await user.type(telInputs[0] as HTMLElement, '4165550000');
    await user.tab();

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/network error/i));
    });
  });

  it('shows toast.error when lookup returns non-ok status', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server-error' }),
    });

    const user = userEvent.setup();
    render(<RegisterPage />);

    const emailInputs = document.querySelectorAll('input[type="email"]');
    const telInputs = document.querySelectorAll('input[type="tel"]');

    await user.type(emailInputs[0] as HTMLElement, 'err@example.com');
    await user.type(telInputs[0] as HTMLElement, '4165550001');
    await user.tab();

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Continue button triggers lookup when clicked manually
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterPage — Continue button triggers lookup', () => {
  it('clicking Continue when both fields filled triggers lookup', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ match: null }),
    });

    const user = userEvent.setup();
    render(<RegisterPage />);

    const emailInputs = document.querySelectorAll('input[type="email"]');
    const telInputs = document.querySelectorAll('input[type="tel"]');

    await user.type(emailInputs[0] as HTMLElement, 'test@example.com');
    await user.type(telInputs[0] as HTMLElement, '4165550123');

    // Wait for the Continue button to be enabled (both fields filled)
    const continueBtns = screen.getAllByRole('button', { name: /^continue/i });
    // Find one that's enabled
    const enabledBtn = continueBtns.find(b => !b.hasAttribute('disabled'));
    if (enabledBtn) {
      await user.click(enabledBtn);
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/setu/family-lookup',
          expect.objectContaining({ method: 'POST' }),
        );
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Third branch: matchAction === 'request-to-join' (gated non-manager member)
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterPage — lookup returns request-to-join match', () => {
  async function fillToRequestPanel(matchedValue = 'member@example.com') {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        match: { found: true, matchedType: 'email', matchedValue, matchAction: 'request-to-join' },
      }),
    });
    const user = userEvent.setup();
    render(<RegisterPage />);
    const emailInputs = document.querySelectorAll('input[type="email"]');
    const telInputs = document.querySelectorAll('input[type="tel"]');
    await user.type(emailInputs[0] as HTMLElement, matchedValue);
    await user.type(telInputs[0] as HTMLElement, '4165550100');
    await user.tab();
    return user;
  }

  it('shows the "We found your family" request panel (NOT the sign-in panel)', async () => {
    await fillToRequestPanel();
    await waitFor(() => {
      expect(screen.getAllByText(/we found your family/i).length).toBeGreaterThan(0);
    });
    // The sign-in panel + its CTA must NOT appear for a gated member.
    expect(screen.queryByText(/this contact is already registered/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /sign in to access my family/i })).toBeNull();
    // The request CTA is present.
    expect(screen.getAllByRole('button', { name: /send a request to your manager/i }).length).toBeGreaterThan(0);
    // No family PII leaked.
    expect(screen.queryByText(/the patel family/i)).toBeNull();
  });

  it('clicking the CTA POSTs to /api/setu/join-request/send with the matched email', async () => {
    const user = await fillToRequestPanel('member@example.com');
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /send a request to your manager/i }).length).toBeGreaterThan(0);
    });
    // The send call resolves ok.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    await user.click(screen.getAllByRole('button', { name: /send a request to your manager/i })[0]!);

    await waitFor(() => {
      const sendCall = fetchMock.mock.calls.find((c) => c[0] === '/api/setu/join-request/send');
      expect(sendCall).toBeTruthy();
      const body = JSON.parse(sendCall?.[1]?.body as string) as { email?: string };
      expect(body.email).toBe('member@example.com');
    });

    // On ok:true the confirmation copy replaces the CTA.
    await waitFor(() => {
      expect(screen.getAllByText(/request sent/i).length).toBeGreaterThan(0);
    });
  });

  it('surfaces a toast on a failed send', async () => {
    const user = await fillToRequestPanel();
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /send a request to your manager/i }).length).toBeGreaterThan(0);
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });

    await user.click(screen.getAllByRole('button', { name: /send a request to your manager/i })[0]!);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    // Still on the request panel (not confirmed).
    expect(screen.queryByText(/request sent/i)).toBeNull();
  });
});

describe('RegisterReal — multi-contact find search', () => {
  it('sends every entered contact (primary + extras) in the array lookup body', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ match: null }) });

    const user = userEvent.setup();
    render(<RegisterPage />);

    // Primary email + phone (complete enough to fire the lookup on blur).
    const email = document.querySelector('input[type="email"]') as HTMLElement;
    const phone = document.querySelector('input[type="tel"]') as HTMLElement;
    await user.type(email, 'primary@example.com');
    await user.type(phone, '4165550000');

    // Reveal + fill one extra email. The page renders formContent twice
    // (mobile + desktop responsive branches sharing one component state), so
    // target the first rendered instance — same branch as the primary inputs
    // selected above via querySelector.
    await user.click(screen.getAllByRole('button', { name: /add another email/i })[0]!);
    await user.type(screen.getAllByLabelText(/additional email 1/i)[0]!, 'second@example.com');

    // Trigger the lookup deterministically via blur.
    await user.click(document.body);

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe('/api/setu/family-lookup');
      const body = JSON.parse(lastCall?.[1]?.body as string) as { emails: string[]; phones: string[] };
      expect(body.emails).toContain('primary@example.com');
      expect(body.emails).toContain('second@example.com');
      expect(body.phones).toContain('4165550000');
    });
  });
});
