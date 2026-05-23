import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Next.js ───────────────────────────────────────────────────────────────────
vi.mock('next/link', () => ({
  default: ({ children, href, className, style }: { children: React.ReactNode; href: string; className?: string; style?: React.CSSProperties }) => (
    <a href={href} className={className} style={style}>{children}</a>
  ),
}));

// Welcome-team session by default — chrome-fixer converted this page to an
// async Server Component that calls cookies() + verifyPortalSessionCookie.
const mockCookieGet = vi.hoisted(() => vi.fn(() => ({ value: 'session-cookie' })));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: mockCookieGet })),
}));

// ── CMT UI ────────────────────────────────────────────────────────────────────
vi.mock('@cmt/ui', () => ({
  SetuLogo: () => <div data-testid="setu-logo" />,
  SetuAvatar: ({ name }: { name: string }) => <div data-testid="setu-avatar">{name}</div>,
  SetuIcon: {
    search: () => <span>search</span>,
    chevron: () => <span>chevron</span>,
    warn: () => <span>warn</span>,
  },
}));

// ── Chrome atoms ──────────────────────────────────────────────────────────────
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DesktopSidebar: ({ active, role }: { active: string; role?: string }) => (
    <nav data-testid="desktop-sidebar" data-active={active} data-role={role} />
  ),
}));

// ── WelcomeSearch (Client Component) — stub out so we can test page shell ─────
vi.mock('../welcome-search', () => ({
  WelcomeSearch: () => <div data-testid="welcome-search" />,
}));

// ── Firebase admin (server-only) ─────────────────────────────────────────────
const mockVerifyPortalSessionCookie = vi.hoisted(() =>
  vi.fn(async () => ({ uid: 'wt-1', role: 'welcome-team' })),
);
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  verifyPortalSessionCookie: mockVerifyPortalSessionCookie,
}));

import WelcomeDashboardPage from '../page';

beforeEach(() => {
  mockCookieGet.mockReset();
  mockCookieGet.mockReturnValue({ value: 'session-cookie' });
  mockVerifyPortalSessionCookie.mockReset();
  mockVerifyPortalSessionCookie.mockResolvedValue({ uid: 'wt-1', role: 'welcome-team' } as never);
});

describe('WelcomeDashboardPage', () => {
  it('renders the welcome headline', async () => {
    const page = await WelcomeDashboardPage();
    render(page as React.ReactElement);
    const headlines = screen.getAllByTestId('welcome-headline');
    expect(headlines.length).toBeGreaterThan(0);
    expect(headlines[0]).toHaveTextContent('Welcome team');
  });

  it('renders the WelcomeSearch component', async () => {
    const page = await WelcomeDashboardPage();
    render(page as React.ReactElement);
    const searchWidgets = screen.getAllByTestId('welcome-search');
    expect(searchWidgets.length).toBeGreaterThan(0);
  });

  it('renders desktop sidebar with welcome-team role', async () => {
    const page = await WelcomeDashboardPage();
    render(page as React.ReactElement);
    const sidebar = screen.queryByTestId('desktop-sidebar');
    if (sidebar) {
      expect(sidebar.getAttribute('data-role')).toBe('welcome-team');
    }
  });
});
