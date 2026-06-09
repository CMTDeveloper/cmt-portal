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
    expect(deriveAdminActive('/admin/users')).toBe('/admin/users');
    expect(deriveAdminActive('/admin')).toBe('/admin');
  });
  it('maps /admin/school-year → its nav item (now in the nav)', () => {
    expect(deriveAdminActive('/admin/school-year')).toBe('/admin/school-year');
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
  it('renders the renamed "Level management" nav item at /admin/levels', () => {
    render(<AdminSidebar displayEmail="a@b.com" hasFamily={false} />);
    const link = screen.getByRole('link', { name: 'Level management' });
    expect(link.getAttribute('href')).toBe('/admin/levels');
    expect(screen.queryByRole('link', { name: 'Levels & teachers' })).toBeNull();
  });
  it('renders the four nav section headers', () => {
    render(<AdminSidebar displayEmail="a@b.com" hasFamily={false} />);
    // Group headers are non-link <div>s; scope the matcher to them so the
    // "Reports" group header isn't confused with the "Reports" nav link.
    const isHeader = (content: string, el: Element | null, re: RegExp) =>
      el?.tagName === 'DIV' && el.closest('a') === null && re.test(content);
    for (const h of [/people & access/i, /bala vihar/i, /^reports$/i, /legacy/i]) {
      expect(screen.getByText((content, el) => isHeader(content, el, h))).toBeTruthy();
    }
  });
});
