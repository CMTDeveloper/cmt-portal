import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminSidebar, deriveAdminActive } from '../admin-sidebar';

describe('deriveAdminActive', () => {
  it('maps /welcome/seva (+ sub-pages) → the Seva item', () => {
    expect(deriveAdminActive('/welcome/seva')).toBe('/welcome/seva');
    expect(deriveAdminActive('/welcome/seva/compliance')).toBe('/welcome/seva');
    expect(deriveAdminActive('/welcome/seva/opp-1')).toBe('/welcome/seva');
  });
  it('maps welcome search + family detail → Family search', () => {
    expect(deriveAdminActive('/welcome')).toBe('/welcome');
    expect(deriveAdminActive('/welcome/family/CMT-X')).toBe('/welcome');
  });
  it('maps admin sub-pages to their items', () => {
    expect(deriveAdminActive('/admin/programs')).toBe('/admin/programs');
    expect(deriveAdminActive('/admin/levels')).toBe('/admin/levels');
    expect(deriveAdminActive('/admin/calendar')).toBe('/admin/calendar');
    expect(deriveAdminActive('/admin/welcome-team')).toBe('/admin/welcome-team');
    expect(deriveAdminActive('/admin')).toBe('/admin');
  });
  it('does not highlight Dashboard for /admin/school-year (no nav item)', () => {
    expect(deriveAdminActive('/admin/school-year')).toBe('');
  });
});

describe('AdminSidebar', () => {
  it('renders core nav links with correct hrefs', () => {
    render(<AdminSidebar displayEmail="a@b.com" hasFamily={false} />);
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/admin');
    expect(screen.getByRole('link', { name: 'Family search' }).getAttribute('href')).toBe('/welcome');
    expect(screen.getByRole('link', { name: 'Seva' }).getAttribute('href')).toBe('/welcome/seva');
  });
  it('marks the active item with aria-current=page (and only that one)', () => {
    render(<AdminSidebar active="/welcome/seva" displayEmail="a@b.com" hasFamily={false} />);
    expect(screen.getByRole('link', { name: 'Seva' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBeNull();
  });
  it('shows "Back to my family" only when hasFamily', () => {
    const { rerender } = render(<AdminSidebar displayEmail="a@b.com" hasFamily />);
    expect(screen.getByRole('link', { name: /back to my family/i })).toBeTruthy();
    rerender(<AdminSidebar displayEmail="a@b.com" hasFamily={false} />);
    expect(screen.queryByRole('link', { name: /back to my family/i })).toBeNull();
  });
});
