import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// usePathname is the only hook these nav components call. Mutable so each test
// can set the "current route" before rendering the Live/mobile variants.
let mockPathname = '/family';
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname }));

// SetuIcon is indexed dynamically (SetuIcon[iconKey]); a Proxy returns a noop
// component for ANY key so we don't have to enumerate them.
vi.mock('@cmt/ui', () => ({
  SetuIcon: new Proxy({}, { get: () => () => null }),
  SetuLogo: () => null,
  SetuAvatar: () => null,
}));

vi.mock('../sign-out-button', () => ({ signOut: vi.fn() }));

import { DesktopSidebar, DesktopSidebarLive } from '../desktop-sidebar';
import { MobileBottomNav } from '../mobile-bottom-nav';

beforeEach(() => {
  mockPathname = '/family';
});

describe('Programs entry in family navigation', () => {
  it('desktop sidebar links Programs → /family/programs', () => {
    render(<DesktopSidebar role="family" />);
    const link = screen.getByRole('link', { name: /programs/i });
    expect(link.getAttribute('href')).toBe('/family/programs');
  });

  it('desktop sidebar highlights Programs as active on /family/programs', () => {
    mockPathname = '/family/programs';
    render(<DesktopSidebarLive />);
    const link = screen.getByRole('link', { name: /programs/i });
    expect(link.style.fontWeight).toBe('600');
  });

  it('has no dedicated Bala Vihar nav item (all programs route through Programs)', () => {
    render(<DesktopSidebar role="family" />);
    expect(screen.queryByRole('link', { name: /bala vihar/i })).toBeNull();
  });

  it('desktop sidebar highlights Programs when enrolling in bala-vihar', () => {
    mockPathname = '/family/enroll/bala-vihar';
    render(<DesktopSidebarLive />);
    expect(screen.getByRole('link', { name: /programs/i }).style.fontWeight).toBe('600');
  });

  it('desktop sidebar highlights Programs when enrolling in a non-BV program', () => {
    mockPathname = '/family/enroll/tabla';
    render(<DesktopSidebarLive />);
    expect(screen.getByRole('link', { name: /programs/i }).style.fontWeight).toBe('600');
  });

  it('mobile bottom bar has a Programs tab and no Bala Vihar tab', () => {
    render(<MobileBottomNav />);
    const link = screen.getByRole('link', { name: /programs/i });
    expect(link.getAttribute('href')).toBe('/family/programs');
    expect(screen.queryByRole('link', { name: /bala vihar/i })).toBeNull();
  });
});
