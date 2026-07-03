import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

// Teacher cross-link: gated on showTeacher (layout computes
// flags.setuTeacher && isTeacher(claims)). Shows in both the family and
// welcome-team desktop sidebars, plus the family mobile "More" sheet.
describe('Teacher cross-link gated on showTeacher', () => {
  it('desktop family sidebar shows Teacher → /teacher when showTeacher', () => {
    render(<DesktopSidebar role="family" showTeacher />);
    const link = screen.getByRole('link', { name: /teacher/i });
    expect(link.getAttribute('href')).toBe('/teacher');
  });

  it('desktop family sidebar hides Teacher when showTeacher is false', () => {
    render(<DesktopSidebar role="family" />);
    expect(screen.queryByRole('link', { name: /teacher/i })).toBeNull();
  });

  it('desktop welcome sidebar shows Teacher when showTeacher (not gated on role)', () => {
    render(<DesktopSidebar role="welcome-team" showTeacher />);
    const link = screen.getByRole('link', { name: /teacher/i });
    expect(link.getAttribute('href')).toBe('/teacher');
  });

  it('mobile "More" sheet shows Teacher → /teacher when showTeacher', () => {
    render(<MobileBottomNav showTeacher />);
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    const link = screen.getByRole('link', { name: /teacher/i });
    expect(link.getAttribute('href')).toBe('/teacher');
  });

  it('mobile "More" sheet hides Teacher when showTeacher is false', () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.queryByRole('link', { name: /teacher/i })).toBeNull();
  });
});

// CMT decision 2026-06-04: general donations are handled via a separate process,
// not Stripe-in-portal, so the Giving + Receipts nav surfaces are hidden. The
// Bala Vihar donation flow stays reachable from the dashboard / enroll (not nav).
describe('Giving + Receipts hidden from family navigation', () => {
  it('desktop sidebar has no Giving or Receipts links', () => {
    render(<DesktopSidebar role="family" />);
    expect(screen.queryByRole('link', { name: /giving/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /receipts/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^my donations$/i })).toBeNull();
  });

  it('mobile bottom bar has no Giving tab', () => {
    render(<MobileBottomNav />);
    expect(screen.queryByRole('link', { name: /giving/i })).toBeNull();
  });

  it('mobile "More" sheet has no donations/receipts entry', () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.queryByRole('link', { name: /my donations/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /receipts/i })).toBeNull();
  });
});

// Slice 1 (Part C): Seva is hidden from FAMILIES until re-enabled. The real
// `flags` is imported here and NEXT_PUBLIC_FEATURE_SETU_SEVA is unset in the
// vitest env, so flags.setuSeva === false and no mocking is needed. The
// welcome-team nav keeps its own Seva entry (staff still use it).
describe('Seva hidden from family navigation when setuSeva is off (default)', () => {
  it('hides the Seva nav item from the family desktop sidebar', () => {
    render(<DesktopSidebar role="family" />);
    expect(screen.queryByText('Seva')).toBeNull();
  });

  it('hides the Seva entry from the mobile "More" sheet', () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.queryByText('Seva')).toBeNull();
  });

  it('keeps the Seva nav item in the welcome-team sidebar (staff still use it)', () => {
    render(<DesktopSidebar role="welcome-team" />);
    const link = screen.getByRole('link', { name: /^seva$/i });
    expect(link.getAttribute('href')).toBe('/welcome/seva');
  });
});
