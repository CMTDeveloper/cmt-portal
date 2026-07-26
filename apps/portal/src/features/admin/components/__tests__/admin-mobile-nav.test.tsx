import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminMobileNav } from '../admin-mobile-nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/programs' }));

// The mobile nav has a DIFFERENT shape from the sidebar: no NAV_GROUPS, three
// separate constants (TABS, MORE_THEMED, MORE_LEGACY). Filtering the sidebar
// alone would leave a bottom bar where half the tabs 302 to /sign-in.

describe('AdminMobileNav - coordinator', () => {
  it('shows only the Programs and Levels tabs', () => {
    render(<AdminMobileNav canSeeAdminOnly={false} />);
    expect(screen.getAllByText('Programs').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Levels').length).toBeGreaterThan(0);
    // Home (/admin) and Calendar (/admin/calendar) are both denied.
    expect(screen.queryAllByText('Home')).toHaveLength(0);
    expect(screen.queryAllByText('Calendar')).toHaveLength(0);
  });

  it('hides the More trigger entirely when nothing is behind it', () => {
    // Every MORE_THEMED and MORE_LEGACY entry is denied to a coordinator, so
    // the trigger would open an empty sheet.
    render(<AdminMobileNav canSeeAdminOnly={false} />);
    expect(screen.queryAllByRole('button', { name: /more/i })).toHaveLength(0);
  });

  it('still shows More when the coordinator has a family to return to', () => {
    // hasFamily puts a real entry in the sheet, so the trigger earns its place.
    render(<AdminMobileNav canSeeAdminOnly={false} hasFamily />);
    expect(screen.getAllByRole('button', { name: /more/i }).length).toBeGreaterThan(0);
  });

  it('shows every tab and the More trigger for an admin', () => {
    render(<AdminMobileNav canSeeAdminOnly />);
    for (const label of ['Home', 'Programs', 'Levels', 'Calendar']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('button', { name: /more/i }).length).toBeGreaterThan(0);
  });

  it('defaults to the full nav when the prop is omitted', () => {
    render(<AdminMobileNav />);
    expect(screen.getAllByText('Home').length).toBeGreaterThan(0);
  });
});
