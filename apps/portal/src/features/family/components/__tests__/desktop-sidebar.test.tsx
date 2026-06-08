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
