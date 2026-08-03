import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DesktopSidebar } from '../desktop-sidebar';

// Regression for the admin-stranded-in-welcome-chrome bug: an admin who clicks
// Seva / Family search lands on /welcome/*, which renders the welcome-team
// sidebar. That sidebar must surface an "Admin" link back to /admin.

describe('DesktopSidebar — Admin shortcut', () => {
  it('shows the Admin link in the welcome-team sidebar when isAdmin', () => {
    render(
      <DesktopSidebar role="welcome-team" isAdmin displayName="Admin" subtitle="a@b.com" showSignOut />,
    );
    const link = screen.getByRole('link', { name: 'Admin' });
    expect(link.getAttribute('href')).toBe('/admin');
  });

  it('hides the Admin link for a non-admin welcome-team user', () => {
    render(<DesktopSidebar role="welcome-team" displayName="Welcome team" subtitle="Welcome team" showSignOut />);
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });

  it('still shows the Admin link in the family sidebar when isAdmin (regression)', () => {
    render(<DesktopSidebar role="family" isAdmin displayName="Jane" showSignOut />);
    expect(screen.getByRole('link', { name: 'Admin' }).getAttribute('href')).toBe('/admin');
  });
});

describe('DesktopSidebar — teacher role', () => {
  it('renders the teacher nav (My classes → /teacher, My family → /family)', () => {
    render(<DesktopSidebar role="teacher" active="home" subtitle="Teacher" showSignOut />);
    expect(screen.getByRole('link', { name: 'My classes' }).getAttribute('href')).toBe('/teacher');
    expect(screen.getByRole('link', { name: 'My family' }).getAttribute('href')).toBe('/family');
    // Does NOT show the family-only Programs/Sign-in-security items.
    expect(screen.queryByRole('link', { name: 'Programs' })).toBeNull();
  });

  it('shows the Admin cross-link for an admin-teacher', () => {
    render(<DesktopSidebar role="teacher" isAdmin subtitle="Teacher" showSignOut />);
    expect(screen.getByRole('link', { name: 'Admin' }).getAttribute('href')).toBe('/admin');
  });
});

describe('DesktopSidebar — coordinator', () => {
  // jsdom renders both responsive branches, so use getAllByText/queryAllByText.
  it('shows the Roster link', () => {
    render(<DesktopSidebar role="coordinator" displayName="Coordinator" showSignOut />);
    expect(screen.getAllByText('Roster').length).toBeGreaterThan(0);
  });

  it.each(['Reports', 'Levels & rosters', 'Seva', 'Prasad'])(
    'does NOT show the %s link, which a coordinator is denied',
    (label) => {
      // Not cosmetic: each of these 302s to /sign-in at middleware for this
      // role, so rendering them is a nav full of dead links.
      render(<DesktopSidebar role="coordinator" displayName="Coordinator" showSignOut />);
      expect(screen.queryAllByText(label)).toHaveLength(0);
    },
  );

  it('falls back to "Coordinator", not "Family member", with no displayName', () => {
    render(<DesktopSidebar role="coordinator" showSignOut />);
    expect(screen.getAllByText('Coordinator').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Family member')).toHaveLength(0);
  });

  it('shows welcome-team the roster and the visitors board, and nothing else', () => {
    // 2026-08-03: the role is scoped to those two screens. Everything listed in
    // the second loop now 302s for this role, so a link to it would be a trap.
    // (This sidebar is only rendered for a NON-admin welcome-team member —
    // /welcome/layout.tsx gives admins AdminSidebarLive instead.)
    render(<DesktopSidebar role="welcome-team" displayName="Welcome team" showSignOut />);
    for (const label of ['Roster', 'Visitors']) {
      expect(screen.getAllByRole('link', { name: label }).length).toBeGreaterThan(0);
    }
    for (const label of ['Reports', 'Levels & rosters', 'Seva', 'Prasad', 'Pending', 'Donation periods']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });
});
