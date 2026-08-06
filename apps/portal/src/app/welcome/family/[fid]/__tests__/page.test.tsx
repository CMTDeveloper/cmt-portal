import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NO_ALLERGIES } from '@cmt/shared-domain';

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

// ── The ADMIN-only override wiring ───────────────────────────────────────────
// Everything below existed untested until 2026-08-04: every test in this file
// signs in as `welcome-team`, and `admin = isAdmin(raw)` gates the whole
// `overridable` computation - so the code that reads enrollments, resolves which
// programs are the adult class, and threads `isAdultClass` per row had ZERO
// coverage, on the very page whose one-day regression prompted this. Found by
// Codex review, not by the suite.
const mockGetEnrollments = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({
  getEnrollments: mockGetEnrollments,
}));
const mockAdultClassKeys = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/adult-class/program-keys', () => ({
  adultStudyClassProgramKeys: mockAdultClassKeys,
  isAdultStudyClassKey: vi.fn(),
}));
// ── The consolidated payment loader ──────────────────────────────────────────
// The page now makes ONE call for enrollments + donations + pledge + verdict
// (it used to read enrollments twice - directly, and again inside the verdict).
// `mockGetEnrollments` and `mockVerdict` survive as the INPUTS to this stub so
// every fixture written before the consolidation still reads the same way.
//
// Unlike `deriveFamilyPayment`, this one CAN throw - deliberately, so the page
// fails closed on a lost enrollments read. `mockLoadPayment.mockRejectedValue`
// is how a test exercises that.
const mockVerdict = vi.hoisted(() => vi.fn());
const mockDonations = vi.hoisted(() => vi.fn());
const mockPledges = vi.hoisted(() => vi.fn());
const mockLoadPayment = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/roster/payment', () => ({ loadFamilyPaymentData: mockLoadPayment }));
vi.mock('@/features/setu/enrollment/get-open-offerings', () => ({
  getOpenOfferingsForFamily: vi.fn(async () => []),
  resolveCurrentOffering: vi.fn(() => null),
}));

// ── get-family-seva-progress helper ───────────────────────────────────────────
const mockGetFamilySevaProgress = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/seva/get-family-seva-progress', () => ({
  getFamilySevaProgress: mockGetFamilySevaProgress,
}));

import { WelcomeFamilyDetailBody as WelcomeFamilyDetailPage } from '../page';

beforeEach(() => {
  mockGetFamilyForWelcome.mockReset();
  mockCookieGet.mockReset();
  mockCookieGet.mockReturnValue({ value: 'session-cookie' });
  mockVerifyPortalSessionCookie.mockReset();
  mockVerifyPortalSessionCookie.mockResolvedValue({ uid: 'wt-1', role: 'welcome-team' } as never);
  mockGetFamilySevaProgress.mockReset();
  mockGetFamilySevaProgress.mockResolvedValue({ currentSevaYear: null, hoursPerYear: 20, hoursEarned: 0 });
  mockGetEnrollments.mockReset();
  mockGetEnrollments.mockResolvedValue([]);
  mockAdultClassKeys.mockReset();
  // Both centres' adult classes, so a fixture using only the literal key cannot
  // pass by accident.
  mockAdultClassKeys.mockResolvedValue(['adult-study-class', 'adult-study-east']);
  mockVerdict.mockReset();
  mockDonations.mockReset();
  mockDonations.mockResolvedValue([]);
  mockPledges.mockReset();
  mockPledges.mockResolvedValue([]);
  mockLoadPayment.mockReset();
  mockLoadPayment.mockImplementation(async () => {
    const enrollments = await mockGetEnrollments();
    const verdict = await mockVerdict();
    return {
      enrollments,
      donations: await mockDonations(),
      pledges: await mockPledges(),
      verdict,
      expectedCAD: null,
      paidCAD: null,
      unknownReason: null,
      paidByPledge: false,
    };
  });
  // Nothing paid: the state in which the off-portal action is legitimate.
  mockVerdict.mockResolvedValue('outstanding');
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

  it('marks a member who no longer participates, and leaves the others unmarked (N=2)', async () => {
    // Vaibhav, 2026-08-05: "one of their child does not have any grade assigned
    // - how is that possible?" It is possible because she is inactive, and
    // `membersRequiringCompletion` deliberately stops asking for a school grade
    // once a family says a child has finished (shipped 2026-08-02 for Sadeesh,
    // who could not otherwise complete registration). The record was right; this
    // screen just drew her identically to an active child with a hole in her
    // profile. get-family-for-welcome has projected `participation` all along -
    // its own comment says the welcome team "would see a retired member as a
    // normal one and chase their missing details" - the page never read it.
    mockGetFamilyForWelcome.mockResolvedValue({
      family: SAMPLE_FAMILY,
      members: [
        { ...SAMPLE_MEMBERS[1]!, mid: 'MID005', firstName: 'Deepika', schoolGrade: null, participation: 'inactive' },
        { ...SAMPLE_MEMBERS[1]!, mid: 'MID006', firstName: 'Pranav', schoolGrade: '10' },
      ],
    });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    // Counted against Deepika's OWN row count rather than a hardcoded 1: this
    // page renders a mobile tree and a desktop tree at once, so every row
    // appears more than once, and tying the two counts together avoids baking
    // in how many trees exist.
    //
    // What this catches on its own is the marker LEAKING - Pranav getting one
    // too would double the count. It does NOT catch an inverted predicate that
    // marks Pranav INSTEAD of Deepika: that swaps which row carries it and the
    // totals still match. The legacy-retired test below is what fails on an
    // inversion, because it asserts the OTHER label is absent. The pair is
    // adequate; neither test is on its own.
    const deepikaRows = screen.getAllByTestId('setu-avatar').filter((a) => a.textContent?.includes('Deepika')).length;
    expect(deepikaRows).toBeGreaterThan(0);
    expect(screen.getAllByText('No longer participating')).toHaveLength(deepikaRows);
  });

  it('says a legacy-retired member finished, rather than implying the family chose it', async () => {
    mockGetFamilyForWelcome.mockResolvedValue({
      family: SAMPLE_FAMILY,
      members: [
        { ...SAMPLE_MEMBERS[1]!, mid: 'MID007', firstName: 'Old', participation: 'inactive', inactiveSource: 'legacy-migration' },
      ],
    });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.getAllByText('Finished (from our records)').length).toBeGreaterThan(0);
    expect(screen.queryByText('No longer participating')).toBeNull();
  });

  it('shows a real allergy in red but NOT the "no known allergies" answer (N=2)', async () => {
    // Vaibhav, 2026-08-05: a red ⚠ None under a child who has no allergies.
    // Both children present on purpose - the sentinel must go quiet WITHOUT
    // taking the real one with it.
    mockGetFamilyForWelcome.mockResolvedValue({
      family: SAMPLE_FAMILY,
      members: [
        { ...SAMPLE_MEMBERS[1]!, mid: 'MID003', firstName: 'Nikhil', foodAllergies: NO_ALLERGIES },
        { ...SAMPLE_MEMBERS[1]!, mid: 'MID004', firstName: 'Anaya', foodAllergies: 'nuts, pollen' },
      ],
    });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.getAllByText(/nuts, pollen/).length).toBeGreaterThan(0);
    expect(screen.queryByText(NO_ALLERGIES)).toBeNull();
  });

  it('renders a View profile link to each member profile', async () => {
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    const links = screen.getAllByRole('link', { name: /view profile/i });
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links.some((a) => a.getAttribute('href') === '/welcome/family/FAM001/members/MID001')).toBe(true);
    expect(links.some((a) => a.getAttribute('href') === '/welcome/family/FAM001/members/MID002')).toBe(true);
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

  it('shows the 4-digit publicFid (via displayFid) instead of the raw fid when assigned', async () => {
    mockGetFamilyForWelcome.mockResolvedValue({
      family: { ...SAMPLE_FAMILY, publicFid: '1042' },
      members: SAMPLE_MEMBERS,
    });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    // The prominent Family ID is the 4-digit publicFid…
    expect(screen.getAllByText(/1042/).length).toBeGreaterThan(0);
    // …and the internal CMT- fid is no longer rendered as the displayed id.
    expect(screen.queryByText(/FAM001/)).toBeNull();
  });
});

describe('WelcomeFamilyDetailPage — seva hours', () => {
  it('renders the seva hours card with earned/required and Met pill when met', async () => {
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });
    mockGetFamilySevaProgress.mockResolvedValue({ currentSevaYear: '2026-27', hoursPerYear: 20, hoursEarned: 24 });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.getAllByText(/Seva hours/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/24 of 20 hrs/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2026-27/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Met$/i).length).toBeGreaterThan(0);
  });

  it('renders the Short pill when hours fall below requirement', async () => {
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });
    mockGetFamilySevaProgress.mockResolvedValue({ currentSevaYear: '2026-27', hoursPerYear: 20, hoursEarned: 5 });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.getAllByText(/5 of 20 hrs/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Short$/i).length).toBeGreaterThan(0);
  });

  it('omits the seva hours card entirely when currentSevaYear is null', async () => {
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });
    mockGetFamilySevaProgress.mockResolvedValue({ currentSevaYear: null, hoursPerYear: 20, hoursEarned: 0 });

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.queryByText(/Seva hours/i)).toBeNull();
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

// ── The admin override wiring, end to end through the PAGE ────────────────────
// Not the leaf control with hand-built props - the page's own job of reading
// enrollments, resolving which programs are the adult class, and threading
// `isAdultClass` onto each row. That wiring is where the 2026-08-04 regression
// lived and it had no test: every other case in this file is `welcome-team`, so
// `admin` is false and none of this code runs.
describe('WelcomeFamilyDetailPage — the off-portal panel as an ADMIN', () => {
  const asAdmin = () =>
    mockVerifyPortalSessionCookie.mockResolvedValue({ uid: 'ad-1', role: 'admin' } as never);

  const enrollment = (over: Record<string, unknown>) => ({
    eid: 'CMT-F1-e1',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    termLabel: '2026-27',
    status: 'active',
    effectiveSuggestedAmount: 400,
    suggestedAmountOverride: null,
    settledOffPortal: false,
    ...over,
  });

  it("calls a Scarborough adult-class waiver 'covered', not 'no reason recorded'", async () => {
    asAdmin();
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });
    // `adult-study-east` is NOT the literal ADULT_STUDY_CLASS key. Before the
    // fix this rendered as an unexplained zero WITH a "Mark paid off-portal"
    // button - one click from recording a payment that never happened.
    mockGetEnrollments.mockResolvedValue([
      enrollment({
        eid: 'CMT-F1-adult-east',
        programKey: 'adult-study-east',
        programLabel: 'Adult Class Scarborough',
        effectiveSuggestedAmount: 0,
        suggestedAmountOverride: 0,
      }),
    ]);

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    // getAllBy*, because the PAGE renders a mobile and a desktop variant from a
    // single component - that is the safe form of responsive branching, not the
    // duplicated-Suspense-mount that broke navigation. A bare getBy* throws
    // "found multiple elements" and reads like a failure of the fix.
    expect(screen.getAllByText(/covered by this family/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no reason recorded/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /mark paid off-portal/i })).toBeNull();
  });

  it('still offers the action on a bare zero that is NOT an adult class', async () => {
    // The remediation path must survive: the production family settled before
    // `settledOffPortal` existed needs this button to re-record it.
    asAdmin();
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });
    mockGetEnrollments.mockResolvedValue([
      enrollment({ effectiveSuggestedAmount: 0, suggestedAmountOverride: 0 }),
    ]);

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.getAllByText(/no reason recorded/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /mark paid off-portal/i }).length).toBeGreaterThan(0);
  });

  it('hides the whole panel when the programs read fails, rather than guessing', async () => {
    // Fail CLOSED. Defaulting isAdultClass to false on a read error would put
    // the money button back on every waiver - the exact bug, reintroduced by a
    // transient Firestore blip.
    asAdmin();
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });
    mockGetEnrollments.mockResolvedValue([
      enrollment({
        programKey: 'adult-study-east',
        effectiveSuggestedAmount: 0,
        suggestedAmountOverride: 0,
      }),
    ]);
    mockAdultClassKeys.mockRejectedValue(new Error('firestore unavailable'));

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.queryByRole('button', { name: /mark paid off-portal/i })).toBeNull();
    expect(screen.queryByText(/no reason recorded/i)).toBeNull();
    // ...and the page still RENDERED. Without this the test would pass just as
    // happily if the page had thrown, which is the trap of asserting absence.
    expect(screen.getAllByText(/Patel/i).length).toBeGreaterThan(0);
  });
});

describe('WelcomeFamilyDetailPage — a family paying by monthly pledge', () => {
  // A live pledge writes NO completed donation docs (there is no webhook), so a
  // verdict built on donations alone calls them unpaid forever - while the
  // roster's Paid chip ORs the pledge in and calls them Paid. That is the same
  // "two screens disagree" report this whole change exists to fix, and the
  // first draft reproduced it for the pledge population. Found in review.
  it('suppresses the off-portal action for a live pledge', async () => {
    mockVerifyPortalSessionCookie.mockResolvedValue({ uid: 'ad-1', role: 'admin' } as never);
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });
    mockGetEnrollments.mockResolvedValue([
      {
        eid: 'CMT-F1-e1', programKey: 'bala-vihar', programLabel: 'Bala Vihar',
        termLabel: '2026-27', status: 'active', effectiveSuggestedAmount: 400,
        suggestedAmountOverride: null, settledOffPortal: false,
      },
    ]);
    // deriveFamilyPayment is what ORs the pledge in; the page must take its word.
    mockVerdict.mockResolvedValue('paid');

    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);

    expect(screen.queryByRole('button', { name: /mark paid off-portal/i })).toBeNull();
    expect(screen.getAllByText(/paid through the portal/i).length).toBeGreaterThan(0);
  });
});

// ── The payment view Vaibhav asked for (2026-08-05) ──────────────────────────
//
// "Showing Enrollment status, Donation status, etc... I am currently checking
// through Stripe logs to see what has happened when someone inquires."
//
// The bar these tests hold the screen to is NOT "renders a chip". It is: does a
// staff member on the phone get an ANSWER without opening Stripe? So they assert
// the arithmetic, the reason behind an `unknown`, and the provider's own error
// words - and, on the volunteer side, the ABSENCE of every money figure.
describe('WelcomeFamilyDetailPage — programs & payment', () => {
  const asAdmin = () =>
    mockVerifyPortalSessionCookie.mockResolvedValue({ uid: 'ad-1', role: 'admin' } as never);

  const enr = (over: Record<string, unknown> = {}) => ({
    eid: 'e1',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    termLabel: '2026-27',
    status: 'active',
    effectiveSuggestedAmount: 400,
    suggestedAmountSnapshot: 400,
    suggestedAmountOverride: null,
    settledOffPortal: false,
    enrolledAt: new Date('2026-09-01T00:00:00Z'),
    offering: { pricingTiers: [{ effectiveFrom: '2026-09-01', amountCAD: 400, label: 'Year' }] },
    ...over,
  });

  const render_ = async () => {
    const page = await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) });
    render(page as React.ReactElement);
  };

  beforeEach(() => {
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });
  });

  it('shows BOTH active programs, not just the first (N=2)', async () => {
    mockLoadPayment.mockResolvedValue({
      enrollments: [enr(), enr({ eid: 'e2', programKey: 'tabla', programLabel: 'Tabla' })],
      donations: [], pledges: [], verdict: 'outstanding',
      expectedCAD: 700, paidCAD: 0, unknownReason: null, paidByPledge: false,
    });

    await render_();

    // getAllBy*: the page renders a mobile and a desktop variant from one
    // component, so every match legitimately appears twice.
    expect(screen.getAllByText('Bala Vihar').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tabla').length).toBeGreaterThan(0);
  });

  it('gives an ADMIN the arithmetic, labelled as all-time (#117)', async () => {
    asAdmin();
    mockLoadPayment.mockResolvedValue({
      enrollments: [enr()], donations: [], pledges: [], verdict: 'outstanding',
      expectedCAD: 400, paidCAD: 150, unknownReason: null, paidByPledge: false,
    });

    await render_();

    // The difference between a chip and an answer: "they owe $400, we have
    // received $150" is what ends the phone call.
    expect(screen.getAllByText(/Expected \$400/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/received \$150 in portal donations \(all time\)/).length).toBeGreaterThan(0);
  });

  it('shows a VOLUNTEER the verdict but NOT a single dollar figure', async () => {
    // Default session in this file is welcome-team. The owner's rule is that the
    // role is roster + visitors; the verdict itself is already theirs (it is the
    // roster's payment column), the amounts behind it are not.
    mockLoadPayment.mockResolvedValue({
      enrollments: [enr()], donations: [], pledges: [], verdict: 'outstanding',
      expectedCAD: 400, paidCAD: 150, unknownReason: null, paidByPledge: false,
    });

    await render_();

    expect(screen.getAllByText('Outstanding').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Expected \$400/)).toBeNull();
    expect(screen.queryByText(/\$150/)).toBeNull();
    // ...and none of the admin activity section.
    expect(screen.queryByText(/Payment activity/i)).toBeNull();
  });

  it('explains WHY it is unknown instead of leaving a bare chip', async () => {
    // The whole point. "Unknown" with no reason is what sent staff to Stripe -
    // where this particular answer does not even exist, because the missing
    // price is in CMT's own offering data.
    mockLoadPayment.mockResolvedValue({
      enrollments: [enr()], donations: [], pledges: [], verdict: 'unknown',
      expectedCAD: null, paidCAD: 0, unknownReason: 'unpriceable-enrollment', paidByPledge: false,
    });

    await render_();

    expect(screen.getAllByText(/no fee recorded against it/i).length).toBeGreaterThan(0);
  });

  it('tells a VOLUNTEER the off-portal reason too - it carries no money', async () => {
    mockLoadPayment.mockResolvedValue({
      enrollments: [enr()], donations: [], pledges: [], verdict: 'unknown',
      expectedCAD: 0, paidCAD: 0, unknownReason: 'off-portal-program', paidByPledge: false,
    });

    await render_();

    // "the teacher collects that one" IS the answer to the payment question,
    // and a volunteer needs it as much as an admin does.
    expect(screen.getAllByText(/teacher collects it directly/i).length).toBeGreaterThan(0);
  });

  it("says a pledge family pays monthly rather than showing them as having given nothing", async () => {
    asAdmin();
    mockLoadPayment.mockResolvedValue({
      enrollments: [enr()], donations: [], pledges: [], verdict: 'paid',
      expectedCAD: 400, paidCAD: 0, unknownReason: null, paidByPledge: true,
    });

    await render_();

    expect(screen.getAllByText('Monthly plan').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/monthly pre-authorized debit/i).length).toBeGreaterThan(0);
  });

  it('degrades honestly when the read fails, and the write panel collapses CLOSED', async () => {
    asAdmin();
    mockLoadPayment.mockRejectedValue(new Error('firestore unavailable'));

    await render_();

    // Not an empty "no programs" state - that reads as "not enrolled", which is
    // the wrong thing to tell someone on the phone.
    expect(screen.getAllByText(/Couldn't load this family's programs/i).length).toBeGreaterThan(0);
    // And the money button must NOT be offered on a family we could not read.
    expect(screen.queryByText(/Mark paid off-portal/i)).toBeNull();
    // The family itself still renders - the volunteer keeps names and allergies.
    expect(screen.getAllByText(/Raj Patel/).length).toBeGreaterThan(0);
  });
});

describe('WelcomeFamilyDetailPage — payment activity (admin only)', () => {
  const asAdmin = () =>
    mockVerifyPortalSessionCookie.mockResolvedValue({ uid: 'ad-1', role: 'admin' } as never);

  const donation = (over: Record<string, unknown> = {}) => ({
    did: 'd1', fid: 'FAM001', label: 'Bala Vihar Donation', amountCAD: 400,
    status: 'completed', coverFee: false, feeCAD: 0, clientReferenceId: 'FID-5001-abc',
    createdAt: new Date('2026-09-10T00:00:00Z'), updatedAt: new Date('2026-09-10T00:00:00Z'),
    ...over,
  });

  const pledge = (over: Record<string, unknown> = {}) => ({
    pid: 'p1', status: 'active', monthlyAmountCAD: 108,
    startedAt: new Date('2026-07-01T00:00:00Z'), activatedAt: new Date('2026-07-03T00:00:00Z'),
    cancelledAt: null, lastCheckedAt: null, lastError: null, needsStripeVerification: false,
    subscriptionId: 'sub_1', verifiedSubscriptionId: null, customerId: 'cus_1',
    ...over,
  });

  beforeEach(() => {
    mockGetFamilyForWelcome.mockResolvedValue({ family: SAMPLE_FAMILY, members: SAMPLE_MEMBERS });
  });

  it('distinguishes a CONFIRMED donation from one that never came back (N=2)', async () => {
    asAdmin();
    mockLoadPayment.mockResolvedValue({
      enrollments: [], donations: [donation(), donation({ did: 'd2', amountCAD: 50, status: 'redirected' })],
      pledges: [], verdict: 'paid', expectedCAD: 400, paidCAD: 400,
      unknownReason: null, paidByPledge: false,
    });

    await render(await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) }) as React.ReactElement);

    // A `redirected` row beside a completed one is the single most confusing
    // thing a family can ask about ("I paid, why does it say I didn't?"), and
    // the copy has to be honest that the portal learns this from the BROWSER.
    expect(screen.getAllByText(/Completed \(confirmed at the Stripe return page\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Started - never confirmed back to the portal/).length).toBeGreaterThan(0);
  });

  it("surfaces the payment service's OWN error words, which nothing has ever displayed", async () => {
    asAdmin();
    const words = '/pad/monthly-subscription failed with 400: branding_settings.display_name';
    mockLoadPayment.mockResolvedValue({
      enrollments: [], donations: [], pledges: [pledge({ status: 'failed', lastError: words })],
      verdict: 'outstanding', expectedCAD: 400, paidCAD: 0, unknownReason: null, paidByPledge: false,
    });

    await render(await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) }) as React.ReactElement);

    expect(screen.getAllByText(words).length).toBeGreaterThan(0);
  });

  it('warns about a subscription the portal cannot stop', async () => {
    asAdmin();
    mockLoadPayment.mockResolvedValue({
      enrollments: [], donations: [], pledges: [pledge({ needsStripeVerification: true })],
      verdict: 'paid', expectedCAD: 400, paidCAD: 0, unknownReason: null, paidByPledge: true,
    });

    await render(await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) }) as React.ReactElement);

    expect(screen.getAllByText(/the portal cannot stop a debit/i).length).toBeGreaterThan(0);
  });

  it('sets the expectation that Stripe holds facts the portal never receives', async () => {
    asAdmin();
    mockLoadPayment.mockResolvedValue({
      enrollments: [], donations: [donation()], pledges: [], verdict: 'paid',
      expectedCAD: 400, paidCAD: 400, unknownReason: null, paidByPledge: false,
    });

    await render(await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) }) as React.ReactElement);

    // Without this an admin reading a complete-looking history would conclude a
    // family never paid, when the truth is that refunds and monthly debits are
    // simply not sent to us.
    expect(screen.getAllByText(/is not sent to the portal/i).length).toBeGreaterThan(0);
  });

  it('says the history is MISSING rather than showing an empty one', async () => {
    asAdmin();
    mockLoadPayment.mockResolvedValue({
      enrollments: [], donations: 'unavailable', pledges: 'unavailable', verdict: 'unknown',
      expectedCAD: null, paidCAD: null, unknownReason: null, paidByPledge: false,
    });

    await render(await WelcomeFamilyDetailPage({ params: Promise.resolve({ fid: 'FAM001' }) }) as React.ReactElement);

    expect(screen.getAllByText(/Donation history could not be loaded/i).length).toBeGreaterThan(0);
    // "No donations" would be a lie told to someone deciding whether to chase a
    // family for money.
    expect(screen.queryByText(/No donations have been started/i)).toBeNull();
  });
});
