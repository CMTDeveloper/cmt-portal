/**
 * Tests for the parameterised /family/enroll/[programKey] page.
 * Adapted from the former enroll/page.test.tsx (which tested the BV-only page).
 * All original T1/T2/M1 scenarios are preserved — now run against the generic
 * ProgramEnrollPage with programKey='bala-vihar'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Feature flags ─────────────────────────────────────────────────────────────
// Only `setuPledge` is read through this module here; `donationsEnabled` is read
// straight off process.env by the page, so the existing vi.stubEnv tests are
// unaffected by this mock.
const flagsMock = vi.hoisted(() => ({ setuPledge: false }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

// The monthly option's own copy is covered by the pledge unit tests and the
// deployed E2E. What is worth pinning HERE is that this page renders it at all.
vi.mock('@/features/setu/pledges/components/monthly-donation-option', () => ({
  MonthlyDonationOption: () => <div data-testid="monthly-option" />,
}));
vi.mock('@/features/setu/pledges/get-family-pledge', () => ({
  getFamilyPledge: vi.fn().mockResolvedValue(null),
}));

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
    // `shield` backs the tax-deductible line in DonationChoice. A missing key
    // here renders as `undefined`, and React's "Element type is invalid" does
    // not name the icon - so keep this list in step with the real components.
    shield: () => <span>shield</span>,
    heart: () => <span>heart</span>,
  },
  SetuAvatar: ({ name }: { name: string }) => <div>{name}</div>,
  Rosette: () => <div />,
  toast: { error: () => {}, success: () => {} },
}));

vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/family/components/enroll-cta', () => ({
  EnrollCta: ({ oid, donationsEnabled, paymentSource }: { oid: string; donationsEnabled: boolean; paymentSource?: string }) => (
    <button data-donations-enabled={String(donationsEnabled)} data-payment-source={paymentSource ?? 'portal'}>Enroll {oid}</button>
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
// Only the QUERY is mocked - `resolveCurrentOffering` (which picks the default
// offering) stays real, so these tests exercise the actual centre-wins rule.
vi.mock('@/features/setu/enrollment/get-open-offerings', async (orig) => ({
  ...(await orig<typeof import('@/features/setu/enrollment/get-open-offerings')>()),
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
    expect(screen.queryByRole('button', { name: /continue to donation/i })).toBeNull();
  });

  it('donations enabled + enrolled: shows Continue to donation button (direct to Stripe)', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', 'true');
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    // Slice: the CTA is now a button that goes straight to Stripe (no /family/donate page).
    expect(screen.getAllByRole('button', { name: /continue to donation/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/donation coming soon/i)).toBeNull();
  });

  it('donations enabled + teacher-managed enrolled: hides Continue link and explains teacher-managed payment', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', 'true');
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([{ ...ACTIVE_PERIOD, paymentSource: 'teacher-managed' }]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    expect(screen.queryByRole('button', { name: /continue to donation/i })).toBeNull();
    expect(screen.getAllByText(/payment is managed by the teacher/i).length).toBeGreaterThan(0);
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

// ─── Free program: no donation ────────────────────────────────────────────────

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

  it('does not render donation block for a free program', async () => {
    mockGetProgram.mockResolvedValue(FREE_PROGRAM);
    mockGetOpenOfferingsForFamily.mockResolvedValue([FREE_OFFERING]);

    const page = await ProgramEnrollPage({ params: makeParams('tabla') });
    render(page);

    expect(screen.queryByText(/donation · suggested/i)).toBeNull();
    expect(screen.queryByText(/suggested donation/i)).toBeNull();
    // Confirm enrollment text is present
    expect(screen.getAllByText(/no donation requirement/i).length).toBeGreaterThan(0);
  });

  it('already-enrolled banner for a free program omits "Proceed to donate below"', async () => {
    mockGetProgram.mockResolvedValue(FREE_PROGRAM);
    mockGetOpenOfferingsForFamily.mockResolvedValue([FREE_OFFERING]);
    mockGetEnrollments.mockResolvedValue([
      {
        eid: 'CMT-AAAA1111-tabla-rolling-2026',
        oid: 'tabla-rolling-2026',
        programKey: 'tabla',
        status: 'active',
        termLabel: 'Rolling 2026',
        suggestedAmountSnapshot: 0,
        suggestedAmountOverride: null,
        effectiveSuggestedAmount: 0,
        offering: null,
      },
    ]);

    const page = await ProgramEnrollPage({ params: makeParams('tabla') });
    render(page);

    expect(screen.getAllByText(/already enrolled in Rolling 2026/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/proceed to donate/i)).toBeNull();
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

// ─────────────────────────────────────────────────────────────────────────────
// The monthly plan must be REACHABLE from the enrollment flow
// ─────────────────────────────────────────────────────────────────────────────

describe('ProgramEnrollPage (bala-vihar) — the monthly alternative', () => {
  /**
   * ── WHY THIS TEST EXISTS ──────────────────────────────────────────────────
   * The pledge shipped on /family/donate, and 180 unit tests plus a 6/6 E2E all
   * passed - because they navigated to that page directly. Nothing asserted
   * that a family ENROLLING ever arrives there, and they do not: EnrollCta
   * sends them straight to Stripe at the full amount, and the dashboard's
   * "Complete donation" does the same. The option existed and was unreachable;
   * a manager testing on preview reported never seeing it.
   *
   * Rendering a component is not the same as a user being able to get to it.
   * This pins the reachability, which is the part that was actually broken.
   */
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', 'true');
    flagsMock.setuPledge = true;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    flagsMock.setuPledge = false;
  });

  it('offers the monthly option beside the one-time ask', async () => {
    mockGetEnrollments.mockResolvedValue([]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    expect(screen.getAllByTestId('monthly-option').length).toBeGreaterThan(0);
  });

  it('offers nothing when the pledge flag is off - production at launch', async () => {
    flagsMock.setuPledge = false;
    mockGetEnrollments.mockResolvedValue([]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    expect(screen.queryByTestId('monthly-option')).toBeNull();
  });

  // ── The ALREADY-ENROLLED state, which is what the design actually targets ──
  //
  // The two tests above use `getEnrollments -> []`, i.e. a family that has not
  // enrolled yet and still sees the standalone monthly card. The far more common
  // state is enrolled-but-unpaid ("Your family is already enrolled. Proceed to
  // donate below"), and that is where the radio group renders. Without these,
  // the group could stop rendering entirely and the suite would stay green -
  // the same reachability blind spot that hid the pledge in the first place.
  describe('already enrolled, donation outstanding', () => {
    beforeEach(() => {
      mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
      mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);
      mockGetDonations.mockResolvedValue([]);
    });

    it('presents both ways to pay as ONE choice', async () => {
      const page = await ProgramEnrollPage({ params: makeParams() });
      render(page);

      // getAllByRole: the page renders a mobile and a desktop tree.
      expect(screen.getAllByRole('radio', { name: /full donation/i }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('radio', { name: /monthly pledge/i }).length).toBeGreaterThan(0);
    });

    it('shows the one-time CTA exactly ONCE per layout, not twice', async () => {
      const page = await ProgramEnrollPage({ params: makeParams() });
      render(page);

      // The mobile tree previously carried the choice inline AND a sticky-footer
      // "Continue to donation" - two primary buttons on one phone screen. Two
      // trees render here (mobile + desktop), so two is correct and three is the
      // regression this guards.
      expect(screen.getAllByRole('button', { name: /continue to donation/i })).toHaveLength(2);
    });

    it('does not also render the standalone monthly card, which would double the ask', async () => {
      const page = await ProgramEnrollPage({ params: makeParams() });
      render(page);

      expect(screen.queryByTestId('monthly-option')).toBeNull();
    });

    it('falls back to the plain CTA when the pledge flag is off', async () => {
      flagsMock.setuPledge = false;
      const page = await ProgramEnrollPage({ params: makeParams() });
      render(page);

      expect(screen.queryByRole('radio', { name: /monthly pledge/i })).toBeNull();
      expect(screen.getAllByRole('button', { name: /continue to donation/i }).length).toBeGreaterThan(0);
    });
  });
});
