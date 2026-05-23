import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({
  default: ({ children, href, style }: { children: React.ReactNode; href: string; style?: React.CSSProperties }) => (
    <a href={href} style={style}>{children}</a>
  ),
}));

vi.mock('@cmt/ui', () => ({
  SetuLogo: () => <div data-testid="setu-logo" />,
  SetuAvatar: ({ name }: { name: string }) => <div data-testid="setu-avatar">{name}</div>,
  SetuIcon: {
    home: () => <span>home</span>,
    people: () => <span>people</span>,
    calendar: () => <span>calendar</span>,
    heart: () => <span>heart</span>,
    receipt: () => <span>receipt</span>,
    search: () => <span>search</span>,
    user: () => <span>user</span>,
    edit: () => <span>edit</span>,
    warn: () => <span>warn</span>,
    check: () => <span>check</span>,
    info: () => <span>info</span>,
    back: () => <span>back</span>,
    plus: () => <span>plus</span>,
    x: () => <span>x</span>,
    chevron: () => <span>chevron</span>,
    mail: () => <span>mail</span>,
    phone: () => <span>phone</span>,
    card: () => <span>card</span>,
    dl: () => <span>dl</span>,
  },
  toast: { error: vi.fn() },
}));

vi.mock('../sign-out-button', () => ({
  signOut: vi.fn(),
}));

import { DesktopSidebar } from '../atoms';
import { signOut } from '../sign-out-button';

describe('DesktopSidebar', () => {
  it('renders passed displayName instead of hardcoded default', () => {
    render(<DesktopSidebar active="home" displayName="Priya Sharma"/>);
    expect(screen.getAllByText('Priya Sharma').length).toBeGreaterThan(0);
    expect(screen.queryByText('Aarti Patel')).toBeNull();
  });

  it('renders default displayName when not passed', () => {
    render(<DesktopSidebar active="home"/>);
    expect(screen.getAllByText('Family member').length).toBeGreaterThan(0);
  });

  it('renders subtitle when passed', () => {
    render(<DesktopSidebar active="home" displayName="Priya Sharma" subtitle="Sharma · FID FAM-001"/>);
    expect(screen.getByText('Sharma · FID FAM-001')).toBeTruthy();
  });

  it('does not render subtitle when not passed', () => {
    render(<DesktopSidebar active="home" displayName="Priya Sharma"/>);
    expect(screen.queryByText('Sharma · FID FAM-001')).toBeNull();
  });

  it('renders sign-out button when showSignOut is true', () => {
    render(<DesktopSidebar active="home" showSignOut/>);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('does not render sign-out button by default', () => {
    render(<DesktopSidebar active="home"/>);
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('calls signOut when sign-out button is clicked', async () => {
    const user = userEvent.setup();
    render(<DesktopSidebar active="home" showSignOut/>);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
  });
});
