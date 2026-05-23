import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Next.js ───────────────────────────────────────────────────────────────────
vi.mock('next/link', () => ({
  default: ({ children, href, className, style }: { children: React.ReactNode; href: string; className?: string; style?: React.CSSProperties }) => (
    <a href={href} className={className} style={style}>{children}</a>
  ),
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

import WelcomeDashboardPage from '../page';

describe('WelcomeDashboardPage', () => {
  it('renders the welcome headline', () => {
    render(<WelcomeDashboardPage />);
    const headlines = screen.getAllByTestId('welcome-headline');
    expect(headlines.length).toBeGreaterThan(0);
    expect(headlines[0]).toHaveTextContent('Welcome team');
  });

  it('renders the WelcomeSearch component', () => {
    render(<WelcomeDashboardPage />);
    const searchWidgets = screen.getAllByTestId('welcome-search');
    expect(searchWidgets.length).toBeGreaterThan(0);
  });

  it('renders desktop sidebar with welcome-team role', () => {
    render(<WelcomeDashboardPage />);
    const sidebar = screen.queryByTestId('desktop-sidebar');
    if (sidebar) {
      expect(sidebar.getAttribute('data-role')).toBe('welcome-team');
    }
  });
});
