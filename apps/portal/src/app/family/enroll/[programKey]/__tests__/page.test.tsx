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
const mockGetFamilyPledge = vi.hoisted(() => vi.fn());
const mockClearAbandoned = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/pledges/clear-abandoned-pledge', () => ({
  clearAbandonedPledge: mockClearAbandoned,
}));
vi.mock('@/features/setu/pledges/get-family-pledge', () => ({
  getFamilyPledge: mockGetFamilyPledge,
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
// Which programs are the adult class is DATA (each centre may run its own), so
// the page asks this helper instead of comparing against the literal
// ADULT_STUDY_CLASS key. The mock mirrors reality: Brampton's legacy key AND
// Scarborough's own program both count.
vi.mock('@/features/setu/adult-class/program-keys', () => ({
  isAdultStudyClassKey: vi.fn(async (k: string | null) =>
    k === 'adult-study-class' || k === 'adult-study-east'),
  adultStudyClassProgramKeys: vi.fn(async () => ['adult-study-class', 'adult-study-east']),
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

/**
 * The Adult Study Class fee WAIVED for a family who has paid Bala Vihar
 * (spec 4.5) - `enrollFamily` writes `suggestedAmountOverride: 0`.
 */
const ACTIVE_ENROLLMENT_WAIVED = {
  ...ACTIVE_ENROLLMENT_WITH_SNAPSHOT,
  suggestedAmountOverride: 0,
  effectiveSuggestedAmount: 0,
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
  mockGetFamilyPledge.mockReset();
  mockGetFamilyPledge.mockResolvedValue(null);
  mockClearAbandoned.mockReset();
  mockClearAbandoned.mockResolvedValue('none');
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
// ─────────────────────────────────────────────────────────────────────────────
// Once enrolled, the member list is a RECORD, not a preview
// ─────────────────────────────────────────────────────────────────────────────
describe('ProgramEnrollPage - who the list shows once enrolled', () => {
  // Reported 2026-07-28: a family who enrolled ONE adult in the Adult Study
  // Class saw all three ticked. Verified against UAT that the DATA was correct -
  // enrolledMids held exactly one - so the page was reporting ELIGIBILITY while
  // wearing a hardcoded checkmark. Nobody was over-enrolled; the screen said so.
  //
  // TWO children, so "shows only the enrolled one" is actually demonstrable -
  // with a single eligible member every filter looks identical (CLAUDE.md #6).
  const SECOND_CHILD = {
    mid: 'CMT-AAAA1111-03', type: 'Child' as const, firstName: 'Meera', lastName: 'Kumar',
    schoolGrade: 'Grade 2', birthMonthYear: '2019-05', gender: 'Female' as const,
    manager: false, joinedAt: new Date(), emergencyContacts: [], enrolledMids: [],
  };

  beforeEach(() => {
    mockGetCurrentFamily.mockResolvedValue({
      family: FAMILY,
      members: [...MEMBERS, SECOND_CHILD],
      isManager: true,
    });
    mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);
  });

  it('lists only the members actually enrolled, not everyone eligible', async () => {
    mockGetEnrollments.mockResolvedValue([
      { ...ACTIVE_ENROLLMENT_WITH_SNAPSHOT, enrolledMids: ['CMT-AAAA1111-02'] },
    ]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    const { container } = render(page);

    expect(container.textContent).toMatch(/Arjun/);
    expect(container.textContent, 'a child who is NOT enrolled is being shown as enrolled')
      .not.toMatch(/Meera/);
  });

  it('calls the list "enrolled", not "enrolling", once the family has joined', async () => {
    mockGetEnrollments.mockResolvedValue([
      { ...ACTIVE_ENROLLMENT_WITH_SNAPSHOT, enrolledMids: ['CMT-AAAA1111-02'] },
    ]);
    const page = await ProgramEnrollPage({ params: makeParams() });
    const { container } = render(page);
    expect(container.textContent).toMatch(/enrolled/i);
  });

  it('falls back to the eligible list when enrolledMids is empty', async () => {
    // A legacy or mid-less enrollment must still show something rather than an
    // empty card.
    mockGetEnrollments.mockResolvedValue([
      { ...ACTIVE_ENROLLMENT_WITH_SNAPSHOT, enrolledMids: [] },
    ]);
    const page = await ProgramEnrollPage({ params: makeParams() });
    const { container } = render(page);
    expect(container.textContent).toMatch(/Arjun/);
    expect(container.textContent).toMatch(/Meera/);
  });

  it('still previews everyone eligible BEFORE enrolling', async () => {
    mockGetEnrollments.mockResolvedValue([]);
    const page = await ProgramEnrollPage({ params: makeParams() });
    const { container } = render(page);
    expect(container.textContent).toMatch(/enrolling/i);
    expect(container.textContent).toMatch(/Meera/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A waived enrollment owes nothing - it must not render a $0 ask
// ─────────────────────────────────────────────────────────────────────────────
describe('ProgramEnrollPage - nothing to pay (the Adult Study Class waiver)', () => {
  // Reported 2026-07-28: the adult-class page showed "$0 · per family" beneath
  // "Proceed to donate below", with a live "Continue to donation" button. It was
  // a permanent dead end - `donationComplete` requires the amount to be > 0, so
  // a waived enrollment is never `paid` and the ask rendered forever; clicking
  // through looped, since both the button and the checkout API reject under $1.
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', 'true');
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WAIVED]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);
    mockGetDonations.mockResolvedValue([]);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('never renders a $0 ask', async () => {
    const page = await ProgramEnrollPage({ params: makeParams() });
    const { container } = render(page);
    expect(container.textContent).not.toMatch(/\$0/);
  });

  it('offers no way to "donate" nothing', async () => {
    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);
    expect(screen.queryByRole('button', { name: /continue to donation/i })).toBeNull();
  });

  it('says the Bala Vihar donation covers it, and offers the way out', async () => {
    const page = await ProgramEnrollPage({ params: makeParams() });
    const { container } = render(page);
    expect(container.textContent).toMatch(/nothing to pay/i);
    expect(screen.getAllByRole('link', { name: /back to dashboard/i }).length).toBeGreaterThan(0);
  });

  it('does NOT claim the family paid - they gave nothing here', async () => {
    // Borrowing the "Paid · thank you" copy would be untrue.
    const page = await ProgramEnrollPage({ params: makeParams() });
    const { container } = render(page);
    expect(container.textContent).not.toMatch(/recorded as paid/i);
    expect(container.textContent).not.toMatch(/Proceed to donate/i);
  });

  it('still asks normally when the amount is a real one', async () => {
    // The guard in the other direction: `nothingToPay` must not swallow a
    // genuine ask just because an override exists.
    mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_OVERRIDE]);
    const page = await ProgramEnrollPage({ params: makeParams() });
    const { container } = render(page);
    expect(container.textContent).toMatch(/\$250/);
    expect(screen.getAllByRole('button', { name: /continue to donation/i }).length).toBeGreaterThan(0);
  });
});

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

  it('offers both ways to pay to a family that has NOT enrolled yet', async () => {
    // This assertion changed shape on 2026-07-28 and the INTENT is what matters:
    // the monthly plan must be reachable by a family joining for the first time.
    // It used to be reachable as a standalone card beside an "Enroll →" button -
    // two primary buttons for one decision. It is now the same radio group the
    // enrolled state gets, whose CTA enrols and then pays.
    mockGetEnrollments.mockResolvedValue([]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    expect(screen.getAllByRole('radio', { name: /monthly pledge/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('radio', { name: /full donation/i }).length).toBeGreaterThan(0);
    // And the label admits that this click also enrols them.
    expect(screen.getAllByRole('button', { name: /enroll and continue/i }).length).toBeGreaterThan(0);
    // The standalone card is gone from this state - it was the second CTA.
    expect(screen.queryByTestId('monthly-option')).toBeNull();
  });

  it('offers nothing when the pledge flag is off - production at launch', async () => {
    flagsMock.setuPledge = false;
    mockGetEnrollments.mockResolvedValue([]);
    mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

    const page = await ProgramEnrollPage({ params: makeParams() });
    render(page);

    expect(screen.queryByTestId('monthly-option')).toBeNull();
  });

  // ── 🔴 Never solicit a mandate a family cannot possibly owe ─────────────────
  //
  // Reported by Vaibhav 2026-07-28 with a screenshot of exactly this page: a
  // Bala Vihar family with NO children read "Add a child to enroll" and
  // "Give $51 monthly" on the same screen. It was not hypothetical - a UAT
  // family with zero children already held a `started` pledge.
  //
  // `monthlyOption` is the BARE card: its button starts a mandate and does not
  // enrol. `DonationChoice` owns the not-yet-enrolled case precisely because it
  // enrols FIRST, so wherever the choice cannot render, the honest answer is no
  // monthly ask at all - not one that leaves a family paying into a program
  // they never joined.
  describe('a family that cannot enroll is never asked to pledge', () => {
    it('shows no monthly ask when the Bala Vihar family has no children', async () => {
      mockGetCurrentFamily.mockResolvedValue({
        family: FAMILY,
        members: [MEMBERS[0]], // the manager alone
        isManager: true,
      });
      mockGetEnrollments.mockResolvedValue([]);
      mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

      const page = await ProgramEnrollPage({ params: makeParams() });
      render(page);

      // The page's own verdict, which the pledge card contradicted.
      expect(screen.getAllByRole('link', { name: /add a child to enroll/i }).length).toBeGreaterThan(0);
      expect(screen.queryByTestId('monthly-option')).toBeNull();
      expect(screen.queryByRole('radio', { name: /monthly pledge/i })).toBeNull();
    });

    it('shows no bare monthly card when a non-manager has not enrolled', async () => {
      // No DonationChoice for a non-manager, so before this the standalone card
      // was all they saw - an ask that could only ever be refused.
      mockGetCurrentFamily.mockResolvedValue({ family: FAMILY, members: MEMBERS, isManager: false });
      mockGetEnrollments.mockResolvedValue([]);
      mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

      const page = await ProgramEnrollPage({ params: makeParams() });
      render(page);

      expect(screen.queryByTestId('monthly-option')).toBeNull();
    });

    // ── The state family9 was actually left in ────────────────────────────────
    //
    // CMT-Z8UXTJIO on UAT: one child, a `started` pledge, ZERO enrollments. The
    // pledge card rendered, which suppresses this page's sticky footer, and the
    // pending branch carries no control of its own - so the screen had no way
    // to enroll ON IT AT ALL. This is a PAGE-level assertion on purpose: the
    // component's own tests cannot see a footer the page decided not to draw.
    // ── Vaibhav, 2026-07-29: an unfinished attempt must not lock this page ────
    // "If someone selects the Pledge option, and not complete... they need to be
    // taken back to options again where they can select donation or pledge."
    // The page resolves that BEFORE reading the pledge, so the ordinary choice
    // returns with no special-case branch. Asserted here because the call is the
    // whole mechanism - drop it and the family is locked out again.
    it('repairs an unfinished attempt and re-reads the resulting state', async () => {
      mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
      mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);
      mockGetFamilyPledge.mockResolvedValueOnce({ pid: 'PLG-9', status: 'started', monthlyAmountCAD: 51 });
      mockClearAbandoned.mockResolvedValue('cleared');

      await ProgramEnrollPage({ params: makeParams() });

      expect(mockClearAbandoned).toHaveBeenCalledWith(FAMILY.fid);
      // Re-read AFTER the repair, or the page would render the state it just fixed.
      expect(mockGetFamilyPledge).toHaveBeenCalledTimes(2);
    });

    // The repair costs a Firestore read and a provider round trip. Paying that on
    // every visit was a real latency regression - it lengthened the window before
    // the donate CTA became interactive and an E2E click on it started missing -
    // so it is gated on a pledge that is actually `started`.
    it('does NO repair work when nothing is in flight', async () => {
      mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
      mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);
      mockGetFamilyPledge.mockResolvedValue(null);

      await ProgramEnrollPage({ params: makeParams() });

      expect(mockClearAbandoned).not.toHaveBeenCalled();
      expect(mockGetFamilyPledge).toHaveBeenCalledTimes(1);
    });

    it('does not touch the pledge at all when the feature is dark', async () => {
      flagsMock.setuPledge = false;
      mockGetEnrollments.mockResolvedValue([ACTIVE_ENROLLMENT_WITH_SNAPSHOT]);
      mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

      await ProgramEnrollPage({ params: makeParams() });

      expect(mockClearAbandoned).not.toHaveBeenCalled();
    });

    it('a family with a confirming pledge and no enrollment can still join', async () => {
      mockGetFamilyPledge.mockResolvedValue({ pid: 'PLG-9', status: 'started', monthlyAmountCAD: 51 });
      mockGetEnrollments.mockResolvedValue([]);
      mockGetOpenOfferingsForFamily.mockResolvedValue([ACTIVE_PERIOD]);

      const page = await ProgramEnrollPage({ params: makeParams() });
      render(page);

      expect(screen.getAllByRole('button', { name: /enroll in bala vihar/i }).length).toBeGreaterThan(0);
      // ...and still no second way to pay while the mandate confirms.
      expect(screen.queryByRole('radio')).toBeNull();
      expect(screen.queryByRole('button', { name: /continue to donation/i })).toBeNull();
    });

    it('shows no bare monthly card when several terms are open and nothing is picked yet', async () => {
      // Two open offerings route to EnrollPanel (its own term picker + submit),
      // so DonationChoice stands down - and the standalone card used to fill the
      // gap with a button that pledges WITHOUT enrolling.
      mockGetEnrollments.mockResolvedValue([]);
      mockGetOpenOfferingsForFamily.mockResolvedValue([
        ACTIVE_PERIOD,
        { ...ACTIVE_PERIOD, oid: 'bv-online-fall-2026', location: null, termLabel: 'Fall 2026 online' },
      ]);

      const page = await ProgramEnrollPage({ params: makeParams() });
      render(page);

      expect(screen.getAllByTestId('enroll-panel').length).toBeGreaterThan(0);
      expect(screen.queryByTestId('monthly-option')).toBeNull();
    });
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
