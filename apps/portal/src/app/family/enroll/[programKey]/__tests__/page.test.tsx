/**
 * Tests for the parameterised /family/enroll/[programKey] page.
 * Adapted from the former enroll/page.test.tsx (which tested the BV-only page).
 * All original T1/T2/M1 scenarios are preserved — now run against the generic
 * ProgramEnrollPage with programKey='bala-vihar'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/server', () => ({ connection: vi.fn().mockResolvedValue(undefined) }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));

vi.mock('next/link', () => ({
  default: ({ children, href, className, style }: { children: React.ReactNode; href: string; className?: string; style?: React.CSSProperties }) => (
    <a href={href} className={className} style={style}>{children}</a>
  ),
}));

vi.mock('@cmt/ui', () => ({
  SetuIcon: {
    back: () => <span>back</span>,
    check: () => <span>check</span>,
    info: () => <span>info</span>,
  },
  SetuAvatar: ({ name }: { name: string }) => <div>{name}</div>,
  Rosette: () => <div />,
}));

vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/family/components/enroll-cta', () => ({
  EnrollCta: ({ oid, donationsEnabled }: { oid: string; donationsEnabled: boolean }) => (
    <button data-donations-enabled={String(donationsEnabled)}>Enroll {oid}</button>
  ),
}));

vi.mock('@/features/family/components/enroll-panel', () => ({
  EnrollPanel: ({ offerings, defaultOid, donationsEnabled }: { offerings: { oid: string; termLabel: string }[]; defaultOid: string; donationsEnabled: boolean }) => (
    <div data-testid="enroll-panel" data-donations-enabled={String(donationsEnabled)} data-default-oid={defaultOid}>
      {offerings.map((o) => (
        <label key={o.oid}>
          <input type="radio" value={o.oid} readOnly />
          {o.termLabel}
        </label>
      ))}
      <button>Enroll {defaultOid}</button>
    </div>
  ),
}));

vi.mock('@/features/family/components/eligible-members-list', () => ({
  EligibleMembersList: ({ members }: { members: { mid: string; firstName: string; lastName: string }[] }) => (
    <div data-testid="eligible-members">
      {members.map((m) => <div key={m.mid}>{m.firstName} {m.lastName}</div>)}
    </div>
  ),
}));

const mockGetCurrentFamily = vi.fn();
const mockGetEnrollments = vi.fn();
const mockGetOpenOfferingsForFamily = vi.fn();
const mockGetProgram = vi.fn();
const mockGetLegacyPaymentStatus = vi.fn();
const mockGetDonations = vi.fn();

vi.mock('@/features/setu/members/get-current-family', () => ({
  getCurrentFamily: (...args: unknown[]) => mockGetCurrentFamily(...args),
}));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({
  getEnrollments: (...args: unknown[]) => mockGetEnrollments(...args),
}));
vi.mock('@/features/setu/enrollment/get-open-offerings', () => ({
  getOpenOfferingsForFamily: (...args: unknown[]) => mockGetOpenOfferingsForFamily(...args),
}));
vi.mock('@/features/setu/programs/get-programs', () => ({
  getProgram: (...args: unknown[]) => mockGetProgram(...args),
}));
vi.mock('@/features/setu/donations/legacy-payment', () => ({
  getLegacyPaymentStatus: (...args: unknown[]) => mockGetLegacyPaymentStatus(...args),
}));
vi.mock('@/features/setu/donations/get-donations', () => ({
  getDonations: (...args: unknown[]) => mockGetDonations(...args),
}));

import ProgramEnrollPage from '../page';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BV_PROGRAM = {
  programKey: 'bala-vihar',
  label: 'Bala Vihar',
  shortDescription: 'Sunday school',
  status: 'active',
  locations: ['Brampton'],
  termType: 'term',
  eligibility: { memberType: 'child' },
  capabilities: {
    usesOfferings: true,
    usesDonation: true,
    usesLevels: true,
    usesCalendar: true,
    attendanceMode: 'check-in',
  },
  displayOrder: 0,
  createdAt: new Date(),
  createdBy: 'admin',
  updatedAt: new Date(),
  updatedBy: 'admin',
};

const FAMILY = {
  fid: 'CMT-AAAA1111',
  location: 'Brampton',
  legacyFid: null,
};

const MEMBERS = [
  { mid: 'CMT-AAAA1111-01', type: 'Adult' as const, firstName: 'Raj', lastName: 'Kumar', schoolGrade: null, birthMonthYear: null, gender: 'Male' as const, manager: true, joinedAt: new Date(), emergencyContacts: [], enrolledMids: [] },
  { mid: 'CMT-AAAA1111-02', type: 'Child' as const, firstName: 'Arjun', lastName: 'Kumar', schoolGrade: 'Grade 4', birthMonthYear: '2017-03', gender: 'Male' as const, manager: false, joinedAt: new Date(), emergencyContacts: [], enrolledMids: [] },
];

const ACTIVE_PERIOD = {
  oid: 'bv-brampton-fall-2026',
  programKey: 'bala-vihar',
  programLabel: 'Bala Vihar',
  location: 'Brampton',
  termLabel: 'Fall 2026',
  termType: 'term',
  startDate: new Date('2026-09-01'),
  endDate: new Date('2027-01-25'),
  pricingTiers: [{ effectiveFrom: '2020-01-01', amountCAD: 500, label: 'Full year' }],
  enabled: true,
  createdAt: new Date(),
  createdBy: 'admin',
  updatedAt: new Date(),
  updatedBy: 'admin',
};

const STALE_ENROLLMENT = {
  eid: 'CMT-AAAA1111-bv-brampton-fall-2025',
  oid: 'bv-brampton-fall-2025',
  programKey: 'bala-vihar',
  status: 'active',
  termLabel: 'Fall 2025',
  effectiveSuggestedAmount: 500,
  suggestedAmountSnapshot: 500,
  suggestedAmountOverride: null,
  offering: null,
};

const ACTIVE_ENROLLMENT_WITH_SNAPSHOT = {
  eid: 'CMT-AAAA1111-bv-brampton-fall-2026',
  oid: 'bv-brampton-fall-2026',
  programKey: 'bala-vihar',
  status: 'active',
  termLabel: 'Fall 2026',
  suggestedAmountSnapshot: 500,
  suggestedAmountOverride: null,
  effectiveSuggestedAmount: 500,
  offering: null,
};

const ACTIVE_ENROLLMENT_WITH_OVERRIDE = {
  ...ACTIVE_ENROLLMENT_WITH_SNAPSHOT,
  suggestedAmountOverride: 250,
  effectiveSuggestedAmount: 250,
};

function makeParams(programKey = 'bala-vihar') {
  return Promise.resolve({ programKey });
}

beforeEach(() => {
  mockGetProgram.mockResolvedValue(BV_PROGRAM);
  mockGetCurrentFamily.mockResolvedValue({ family: FAMILY, members: MEMBERS, isManager: true });
  mockGetEnrollments.mockResolvedValue([]);
  mockGetOpenOfferingsForFamily.mockResolvedValue([]);
  mockGetLegacyPaymentStatus.mockResolvedValue('unpaid');
  mockGetDonations.mockResolvedValue([]);
});

// ─── T2: effectiveSuggestedAmount ─────────────────────────────────────────────

describe('ProgramEnrollPage (bala-vihar) — effectiveSuggestedAmount (T2)', () => {
  it('enrolled family sees snapshot amount even if period amount changes', async () => {
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([{ ...ACTIVE_PERIOD, suggestedAmount: 600 }]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    expect(screen.getAllByText(/\$500/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$600/)).toBeNull();
  });

  it('welcome-team override wins over snapshot', async () => {
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_OVERRIDE]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    expect(screen.getAllByText(/\$250/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$500/)).toBeNull();
  });
});

// ─── T1: Donation flag gating ─────────────────────────────────────────────────

describe('ProgramEnrollPage (bala-vihar) — donation flag gating (T1)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('donations disabled + enrolled: shows "donation coming soon" instead of Continue link', async () => {
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    expect(screen.getAllByText(/donation coming soon/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /continue to donation/i })).toBeNull();
  });

  it('donations enabled + enrolled: shows Continue to donation link', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', 'true');
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    expect(screen.getAllByRole('link', { name: /continue to donation/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/donation coming soon/i)).toBeNull();
  });

  it('donations enabled + enrolled + already paid: shows paid panel, not Continue to donation', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', 'true');
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);
    // A completed Setu donation covering the suggested amount → "paid".
    mockGetDonations.mockResolvedValue([
      { status: 'completed', eid: 'CMT-AAAA1111-bv-brampton-fall-2026', amountCAD: 500 },
    ]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    expect(screen.getAllByText(/recorded as paid|paid ·/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /continue to donation/i })).toBeNull();
  });
});

// ─── M1: Stale enrollment guard ───────────────────────────────────────────────

describe('ProgramEnrollPage (bala-vihar) — stale enrollment guard (M1)', () => {
  it('stale enrollment + no active period → shows no-period banner, not stale banner', async () => {
    mockGetEnrollments.mockResolvedValue([STALE_ENROLLMENT]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    expect(screen.queryByText(/already enrolled/i)).toBeNull();
    expect(screen.getAllByText(/no open enrollment/i).length).toBeGreaterThan(0);
  });

  it('stale enrollment + active period with different oid → shows enroll CTA, not stale banner', async () => {
    mockGetEnrollments.mockResolvedValue([STALE_ENROLLMENT]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    expect(screen.queryByText(/already enrolled/i)).toBeNull();
    expect(screen.getAllByText(/enroll/i).length).toBeGreaterThan(0);
  });

  it('current enrollment matching active period → shows "already enrolled" banner', async () => {
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    expect(screen.getAllByText(/already enrolled in Fall 2026/i).length).toBeGreaterThan(0);
  });
});

// ─── Free program: no dakshina ────────────────────────────────────────────────

describe('ProgramEnrollPage — free program (usesDonation=false)', () => {
  const FREE_PROGRAM = {
    ...BV_PROGRAM,
    programKey: 'tabla',
    label: 'Tabla',
    eligibility: { memberType: 'any' as const },
    capabilities: {
      usesOfferings: true,
      usesDonation: false,
      usesLevels: false,
      usesCalendar: false,
      attendanceMode: 'none' as const,
    },
  };

  const FREE_OFFERING = {
    ...ACTIVE_PERIOD,
    oid: 'tabla-rolling-2026',
    programKey: 'tabla',
    programLabel: 'Tabla',
    location: null,
    termLabel: 'Rolling 2026',
    termType: 'rolling',
    endDate: null,
  };

  it('does not render dakshina block for a free program', async () => {
    mockGetProgram.mockResolvedValue(FREE_PROGRAM);
    mockGetOpenOfferingsForFamily.mockResolvedValue([FREE_OFFERING]);

    const page = await ProgramEnrollPage({ params: makeParams('tabla') });
    render(page);

    expect(screen.queryByText(/dakshina/i)).toBeNull();
    expect(screen.queryByText(/suggested donation/i)).toBeNull();
    // Confirm enrollment text is present
    expect(screen.getAllByText(/no donation requirement/i).length).toBeGreaterThan(0);
  });
});

// ─── #3: legacy-payment bridge is Bala Vihar-only ─────────────────────────────

describe('ProgramEnrollPage — legacy-payment bridge is Bala Vihar-only (#3)', () => {
  const TABLA_DONATION_PROGRAM = {
    ...BV_PROGRAM,
    programKey: 'tabla',
    label: 'Tabla',
    eligibility: { memberType: 'any' as const },
    capabilities: {
      usesOfferings: true,
      usesDonation: true,
      usesLevels: false,
      usesCalendar: false,
      attendanceMode: 'none' as const,
    },
  };

  // An offering mis-configured with paymentSource:'legacy' on a NON-BV program.
  const TABLA_LEGACY_OFFERING = {
    ...ACTIVE_PERIOD,
    oid: 'tabla-brampton-2026-27',
    programKey: 'tabla',
    programLabel: 'Tabla',
    termLabel: '2026-27',
    paymentSource: 'legacy' as const,
  };

  const TABLA_ENROLLMENT = {
    ...ACTIVE_ENROLLMENT_WITH_SNAPSHOT,
    eid: 'CMT-AAAA1111-tabla-brampton-2026-27',
    oid: 'tabla-brampton-2026-27',
    programKey: 'tabla',
    termLabel: '2026-27',
  };

  it('never consults the BV roster for a non-BV legacy offering (no false "Paid")', async () => {
    mockGetProgram.mockResolvedValue(TABLA_DONATION_PROGRAM);
    mockGetEnrollments.mockResolvedValue([TABLA_ENROLLMENT]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([TABLA_LEGACY_OFFERING]);
    // Would wrongly mark Tabla "paid" from the BV roster if the gate were missing.
    mockGetLegacyPaymentStatus.mockResolvedValue('paid');
    mockGetLegacyPaymentStatus.mockClear();

    const page = await ProgramEnrollPage({ params: makeParams('tabla') });
    render(page);

    // The BV-only gate means the legacy bridge is short-circuited for Tabla, so
    // getLegacyPaymentStatus (which reads the BV roster) is never called.
    expect(mockGetLegacyPaymentStatus).not.toHaveBeenCalled();
  });
});
