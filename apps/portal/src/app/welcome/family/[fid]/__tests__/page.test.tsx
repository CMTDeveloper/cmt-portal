import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Next.js ───────────────────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));

// Welcome-team session by default — individual tests can override via the
// session mock to exercise the access-denied path.
const mockCookieGet = vi.hoisted(() => vi.fn(() => ({ value: 'session-cookie' })));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: mockCookieGet })),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, className, style }: { children: React.ReactNode; href: string; className?: string; style?: React.CSSProperties }) => (
    <a href={href} className={className} style={style}>{children}</a>
  ),
}));

// ── CMT UI ────────────────────────────────────────────────────────────────────
vi.mock('@cmt/ui', () => ({
  SetuAvatar: ({ name }: { name: string }) => <div data-testid="setu-avatar">{name}</div>,
  SetuIcon: {
    back: () => <span>back</span>,
    warn: () => <span>warn</span>,
    chevron: () => <span>chevron</span>,
  },
}));

// ── Chrome atoms ──────────────────────────────────────────────────────────────
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DesktopSidebar: ({ active, role }: { active: string; role?: string }) => (
    <nav data-testid="desktop-sidebar" data-active={active} data-role={role} />
  ),
}));

// ── Firebase admin (server-only) ─────────────────────────────────────────────
const mockVerifyPortalSessionCookie = vi.hoisted(() =>
  vi.fn(async () => ({ uid: 'wt-1', role: 'welcome-team' })),
);
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  verifyPortalSessionCookie: mockVerifyPortalSessionCookie,
}));

// ── get-family-for-welcome helper ─────────────────────────────────────────────
const mockGetFamilyForWelcome = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/search/get-family-for-welcome', () => ({
  getFamilyForWelcome: mockGetFamilyForWelcome,
}));

import { WelcomeFamilyDetailBody as WelcomeFamilyDetailPage } from '../page';

beforeEach(() => {
  mockGetFamilyForWelcome.mockReset();
  mockCookieGet.mockReset();
  mockCookieGet.mockReturnValue({ value: 'session-cookie' });
  mockVerifyPortalSessionCookie.mockReset();
  mockVerifyPortalSessionCookie.mockResolvedValue({ uid: 'wt-1', role: 'welcome-team' } as never);
});

const SAMPLE_FAMILY = {
  fid: 'FAM001',
  legacyFid: '4421',
  name: 'Patel',
  location: 'Brampton' as const,
  createdAt: new Date('2020-09-01'),
  managers: ['MID001'],
  searchKeys: ['patel'],
};

const SAMPLE_MEMBERS = [
  {
    mid: 'MID001',
    uid: null,
    firstName: 'Raj',
    lastName: 'Patel',
    type: 'Adult' as const,
    gender: 'Male' as const,
    manager: true,
    joinedAt: new Date('2020-09-01'),
    email: 'raj@example.com',
    phone: '4165551234',
    schoolGrade: null,
    birthMonthYear: null,
    volunteeringSkills: [],
    foodAllergies: null,
    emergencyContacts: [null, null] as [null, null],
  },
  {
    mid: 'MID002',
    uid: null,
    firstName: 'Priya',
    lastName: 'Patel',
    type: 'Child' as const,
    gender: 'Female' as const,
    manager: false,
    joinedAt: new Date('2020-09-01'),
    email: null,
    phone: null,
    schoolGrade: 'Grade 3',
    birthMonthYear: null,
    volunteeringSkills: [],
    foodAllergies: 'Peanuts',
    emergencyContacts: [null, null] as [null, null],
  },
];

describe('WelcomeFamilyDetailPage — with data', () => {
  it('renders family name when helper returns data', async () => {
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.getAllByText(/Patel/i).length).toBeGreaterThan(0);
  });

  it('renders both members', async () => {
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    const avatars = screen.getAllByTestId('setu-avatar');
    expect(avatars.length).toBeGreaterThanOrEqual(2);
  });

  it('shows allergy warning for child with food allergies', async () => {
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.getAllByText(/Peanuts/i).length).toBeGreaterThan(0);
  });

  it('displays both fid and legacyFid', async () => {
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.getAllByText(/FAM001/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4421/).length).toBeGreaterThan(0);
  });
});

describe('WelcomeFamilyDetailPage — not found', () => {
  it('throws notFound when helper returns null', async () => {
    mockGetFamilyForWelcome.mockResolvedValue(null);

    await expect(
      WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'MISSING' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('WelcomeFamilyDetailPage — defense-in-depth role gate', () => {
  it('renders Access denied when no session cookie present', async () => {
    mockCookieGet.mockReturnValueOnce(undefined as never);
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.getByText(/access denied/i)).toBeDefined();
    expect(mockGetFamilyForWelcome).not.toHaveBeenCalled();
  });

  it('renders Access denied when session role is not welcome-team', async () => {
    mockVerifyPortalSessionCookie.mockResolvedValueOnce({ uid: 'fm-1', role: 'family-manager', fid: 'X', mid: 'X-01' } as never);
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.getByText(/access denied/i)).toBeDefined();
    expect(mockGetFamilyForWelcome).not.toHaveBeenCalled();
  });

  it('renders Access denied when verifyPortalSessionCookie returns null', async () => {
    mockVerifyPortalSessionCookie.mockResolvedValueOnce(null as never);
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.getByText(/access denied/i)).toBeDefined();
    expect(mockGetFamilyForWelcome).not.toHaveBeenCalled();
  });
});
