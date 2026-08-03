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

/**
 * Reported on preview 2026-08-03: an admin granted welcomefamily@gmail.com the
 * welcome-team role, the grant landed correctly (roleAssignments/{mid} carried
 * roles:['welcome-team']), and the parent still saw nothing — the family chrome
 * only ever asked isAdmin/isTeacher, so the Sevak section could render Admin and
 * Teacher and nothing else. A capability with no route to it is indistinguishable
 * from one that was never granted.
 */
describe('DesktopSidebar — a parent who is ALSO staff gets a way in', () => {
  it('shows a Welcome team shortcut for a welcome-team parent', () => {
    render(<DesktopSidebar role="family" displayName="A Parent" staffArea="welcome-team" />);
    const link = screen.getByRole('link', { name: /welcome team/i });
    expect(link.getAttribute('href')).toBe('/welcome/roster');
  });

  it('labels it Coordinator for a coordinator parent, same destination', () => {
    render(<DesktopSidebar role="family" displayName="A Parent" staffArea="coordinator" />);
    const link = screen.getByRole('link', { name: /^coordinator$/i });
    expect(link.getAttribute('href')).toBe('/welcome/roster');
  });

  it('opens the Sevak section for staffArea ALONE (neither admin nor teacher)', () => {
    // The trap: `showSevakSection` gated on admin||teacher, so the new link was
    // dead code for exactly the person who reported the bug — a welcome-team
    // parent who is neither. This asserts the gate, not just the link.
    render(<DesktopSidebar role="family" displayName="A Parent" staffArea="welcome-team" />);
    expect(screen.getByText('Sevak')).toBeTruthy();
  });

  it('shows NOTHING extra for a plain family with no staff role', () => {
    render(<DesktopSidebar role="family" displayName="A Parent" />);
    expect(screen.queryByRole('link', { name: /welcome team/i })).toBeNull();
    expect(screen.queryByText('Sevak')).toBeNull();
  });

  it('does not double up for an admin, who already has the Admin link', () => {
    // The layout passes staffArea=null for admins on purpose: isWelcomeTeam()
    // returns true for admin, so deriving it from that alone would give every
    // admin two links to overlapping places.
    render(<DesktopSidebar role="family" displayName="An Admin" isAdmin staffArea={null} />);
    expect(screen.getByRole('link', { name: /admin/i }).getAttribute('href')).toBe('/admin');
    expect(screen.queryByRole('link', { name: /welcome team/i })).toBeNull();
  });
});

/**
 * The mirror of the bug above, found by the same person one click later: the
 * link INTO the staff area worked, and then there was no way back. The mobile
 * welcome nav has always had a "My family" tab; welcome/layout.tsx computed
 * `hasFamily` and passed it only to that nav, so on a desktop a welcome-team
 * parent reached the roster and had nothing but Sign out.
 */
describe('DesktopSidebar — a staff member who is also a parent can get back', () => {
  it('offers My family on the welcome-team sidebar when they have one', () => {
    render(<DesktopSidebar role="welcome-team" displayName="Welcome team" hasFamily />);
    expect(screen.getByRole('link', { name: /my family/i }).getAttribute('href')).toBe('/family');
  });

  it('offers it on the coordinator sidebar too', () => {
    render(<DesktopSidebar role="coordinator" displayName="Coordinator" hasFamily />);
    expect(screen.getByRole('link', { name: /my family/i }).getAttribute('href')).toBe('/family');
  });

  it('omits it for a standalone staff account with no family', () => {
    // setu-test-sevak has no fid; a "My family" link would 302 them.
    render(<DesktopSidebar role="welcome-team" displayName="Welcome team" />);
    expect(screen.queryByRole('link', { name: /my family/i })).toBeNull();
  });

  it('does not disturb the role scoping it sits alongside', () => {
    render(<DesktopSidebar role="welcome-team" displayName="Welcome team" hasFamily />);
    for (const label of ['Roster', 'Visitors', 'My family']) {
      expect(screen.getAllByRole('link', { name: label }).length).toBeGreaterThan(0);
    }
    for (const gone of ['Reports', 'Levels & rosters', 'Seva', 'Prasad']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });
});
