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
// The donation sum + the shared roster classifier, so the panel can tell a
// family who has already paid from one who has not. Unmocked, the real
// donations read reaches Firestore, the joint promise rejects, and the panel
// correctly disappears - which is the fail-closed path, not a test fixture.
const mockPaidCAD = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/roster/donations-sum', () => ({
  sumCompletedDonations: mockPaidCAD,
}));
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
  mockPaidCAD.mockReset();
  // Nothing donated: the state in which the off-portal action is legitimate.
  mockPaidCAD.mockResolvedValue(0);
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
