import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  EnrollCta: ({ pid }: { pid: string }) => <button>Enroll {pid}</button>,
}));

const mockGetCurrentFamily = vi.fn();
const mockGetEnrollments = vi.fn();
const mockResolveActivePeriod = vi.fn();

vi.mock('@/features/setu/members/get-current-family', () => ({
  getCurrentFamily: (...args: unknown[]) => mockGetCurrentFamily(...args),
}));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({
  getEnrollments: (...args: unknown[]) => mockGetEnrollments(...args),
}));
vi.mock('@/features/setu/enrollment/resolve-active-period', () => ({
  resolveActivePeriod: (...args: unknown[]) => mockResolveActivePeriod(...args),
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
  pid: 'bv-brampton-fall-2025',
  status: 'active',
  periodLabel: 'Fall 2025',
};

const ACTIVE_PERIOD = {
  pid: 'bv-brampton-fall-2026',
  periodLabel: 'Fall 2026',
  startDate: new Date('2026-09-01'),
  endDate: new Date('2027-01-25'),
  suggestedAmount: 500,
};

beforeEach(() => {
  mockGetCurrentFamily.mockResolvedValue({ family: FAMILY, members: MEMBERS, isManager: true });
  mockGetEnrollments.mockResolvedValue([]);
  mockResolveActivePeriod.mockResolvedValue(null);
});

describe('EnrollPage — stale enrollment guard (M1)', () => {
  it('stale enrollment + no active period → shows "no active period" banner, not stale banner', async () => {
    mockGetEnrollments.mockResolvedValue([STALE_ENROLLMENT]);
    mockResolveActivePeriod.mockResolvedValue(null);

    const page = await EnrollPage();
    render(page);

    expect(screen.queryByText(/already enrolled/i)).toBeNull();
    expect(screen.getAllByText(/no active bala vihar enrollment period/i).length).toBeGreaterThan(0);
  });

  it('stale enrollment + active period with different pid → shows enroll card, not stale banner', async () => {
    mockGetEnrollments.mockResolvedValue([STALE_ENROLLMENT]);
    mockResolveActivePeriod.mockResolvedValue(ACTIVE_PERIOD);

    const page = await EnrollPage();
    render(page);

    expect(screen.queryByText(/already enrolled/i)).toBeNull();
    // Enroll button should be rendered (via EnrollCta mock)
    expect(screen.getAllByText(/enroll/i).length).toBeGreaterThan(0);
  });

  it('current enrollment matching active period → shows "already enrolled" banner', async () => {
    mockGetEnrollments.mockResolvedValue([{
      eid: 'CMT-AAAA1111-bv-brampton-fall-2026',
      pid: 'bv-brampton-fall-2026',
      status: 'active',
      periodLabel: 'Fall 2026',
    }]);
    mockResolveActivePeriod.mockResolvedValue(ACTIVE_PERIOD);

    const page = await EnrollPage();
    render(page);

    expect(screen.getAllByText(/already enrolled in Fall 2026/i).length).toBeGreaterThan(0);
  });
});
