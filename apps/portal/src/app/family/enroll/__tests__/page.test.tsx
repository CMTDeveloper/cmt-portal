import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/server', () => ({ connection: vi.fn().mockResolvedValue(undefined) }));

vi.mock('next/link', () => ({
  default: ({ children, href, className, style }: { children: React.ReactNode; href: string; className?: string; style?: React.CSSProperties }) => (
    <a href={href} className={className} style={style}>{children}</a>
  ),
}));

vi.mock('@cmt/ui', () => ({
  SetuIcon: { back: () => <span>back</span>, check: () => <span>check</span> },
  SetuAvatar: ({ name }: { name: string }) => <div>{name}</div>,
  Rosette: () => <div/>,
}));

vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/family/components/enroll-cta', () => ({
  EnrollCta: ({ pid, donationsEnabled }: { pid: string; donationsEnabled: boolean }) => (
    <button data-donations-enabled={String(donationsEnabled)}>Enroll {pid}</button>
  ),
}));

const mockGetCurrentFamily = vi.fn();
const mockGetEnrollments = vi.fn();
const mockGetOpenOfferings = vi.fn();

vi.mock('@/features/setu/members/get-current-family', () => ({
  getCurrentFamily: (...args: unknown[]) => mockGetCurrentFamily(...args),
}));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({
  getEnrollments: (...args: unknown[]) => mockGetEnrollments(...args),
}));
vi.mock('@/features/setu/enrollment/get-open-offerings', () => ({
  getOpenOfferings: (...args: unknown[]) => mockGetOpenOfferings(...args),
}));

import EnrollPage from '../page';

const FAMILY = {
  fid: 'CMT-AAAA1111',
  location: 'Brampton',
};

const MEMBERS = [
  { mid: 'CMT-AAAA1111-01', type: 'Parent', firstName: 'Raj', lastName: 'Kumar', schoolGrade: null },
  { mid: 'CMT-AAAA1111-02', type: 'Child', firstName: 'Arjun', lastName: 'Kumar', schoolGrade: 'Grade 4' },
];

const STALE_ENROLLMENT = {
  eid: 'CMT-AAAA1111-bv-brampton-fall-2025',
  oid: 'bv-brampton-fall-2025',
  status: 'active',
  termLabel: 'Fall 2025',
};

const ACTIVE_PERIOD = {
  oid: 'bv-brampton-fall-2026',
  termLabel: 'Fall 2026',
  startDate: new Date('2026-09-01'),
  endDate: new Date('2027-01-25'),
  pricingTiers: [{ effectiveFrom: '2020-01-01', amountCAD: 500, label: 'Full year' }],
};

beforeEach(() => {
  mockGetCurrentFamily.mockResolvedValue({ family: FAMILY, members: MEMBERS, isManager: true });
  mockGetEnrollments.mockResolvedValue([]);
  mockGetOpenOfferings.mockResolvedValue([]);
});

const ACTIVE_ENROLLMENT_WITH_SNAPSHOT = {
  eid: 'CMT-AAAA1111-bv-brampton-fall-2026',
  oid: 'bv-brampton-fall-2026',
  status: 'active',
  termLabel: 'Fall 2026',
  suggestedAmountSnapshot: 500,
  suggestedAmountOverride: null,
  effectiveSuggestedAmount: 500,
};

const ACTIVE_ENROLLMENT_WITH_OVERRIDE = {
  eid: 'CMT-AAAA1111-bv-brampton-fall-2026',
  oid: 'bv-brampton-fall-2026',
  status: 'active',
  termLabel: 'Fall 2026',
  suggestedAmountSnapshot: 500,
  suggestedAmountOverride: 250,
  effectiveSuggestedAmount: 250,
};

describe('EnrollPage — effectiveSuggestedAmount (T2)', () => {
  it('enrolled family sees snapshot amount even if period amount changes', async () => {
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
    mockGetOpenOfferings.mockResolvedValue([{ ...ACTIVE_PERIOD, suggestedAmount: 600 }]);

    const page = await EnrollPage();
    render(page);

    // Should show the snapshot amount (500), not the updated period amount (600)
    expect(screen.getAllByText(/\$500/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$600/)).toBeNull();
  });

  it('welcome-team override wins over snapshot', async () => {
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_OVERRIDE]);
    mockGetOpenOfferings.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await EnrollPage();
    render(page);

    // Should show the override amount (250), not the snapshot (500)
    expect(screen.getAllByText(/\$250/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$500/)).toBeNull();
  });
});

describe('EnrollPage — donation flag gating (T1)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('donations disabled + enrolled: shows "donation coming soon" instead of Continue to donation link', async () => {
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
    mockGetOpenOfferings.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await EnrollPage();
    render(page);

    expect(screen.getAllByText(/donation coming soon/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /continue to donation/i })).toBeNull();
  });

  it('donations enabled + enrolled: shows Continue to donation link', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', 'true');
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
    mockGetOpenOfferings.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await EnrollPage();
    render(page);

    expect(screen.getAllByRole('link', { name: /continue to donation/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/donation coming soon/i)).toBeNull();
  });
});

describe('EnrollPage — stale enrollment guard (M1)', () => {
  it('stale enrollment + no active period → shows "no active period" banner, not stale banner', async () => {
    mockGetEnrollments.mockResolvedValue([STALE_ENROLLMENT]);
    mockGetOpenOfferings.mockResolvedValue([]);

    const page = await EnrollPage();
    render(page);

    expect(screen.queryByText(/already enrolled/i)).toBeNull();
    expect(screen.getAllByText(/no active bala vihar enrollment period/i).length).toBeGreaterThan(0);
  });

  it('stale enrollment + active period with different pid → shows enroll card, not stale banner', async () => {
    mockGetEnrollments.mockResolvedValue([STALE_ENROLLMENT]);
    mockGetOpenOfferings.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await EnrollPage();
    render(page);

    expect(screen.queryByText(/already enrolled/i)).toBeNull();
    // Enroll button should be rendered (via EnrollCta mock)
    expect(screen.getAllByText(/enroll/i).length).toBeGreaterThan(0);
  });

  it('current enrollment matching active period → shows "already enrolled" banner', async () => {
    mockGetEnrollments.mockResolvedValue([{
      eid: 'CMT-AAAA1111-bv-brampton-fall-2026',
      oid: 'bv-brampton-fall-2026',
      status: 'active',
      termLabel: 'Fall 2026',
    }]);
    mockGetOpenOfferings.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await EnrollPage();
    render(page);

    expect(screen.getAllByText(/already enrolled in Fall 2026/i).length).toBeGreaterThan(0);
  });
});
