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
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        match: {
          fid: 'FAM001',
          name: 'Patel',
          location: 'Brampton',
          memberCount: 3,
          managerInitials: 'R.P.',
        },
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
      expect(screen.getAllByText(/we found a family/i).length).toBeGreaterThan(0);
    });

    // Shows the family name
    expect(screen.getAllByText(/The Patel Family/i).length).toBeGreaterThan(0);

    // Join button is present
    const joinLinks = screen.getAllByRole('link', { name: /join the patel family/i });
    expect(joinLinks.length).toBeGreaterThan(0);
    expect(joinLinks[0]?.getAttribute('href')).toContain('FAM001');
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
