import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Next.js ───────────────────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }));

const mockCookieGet = vi.hoisted(() => vi.fn(() => ({ value: 'session-cookie' })));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: mockCookieGet })) }));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock('@cmt/ui', () => ({ SetuIcon: { back: () => <span>back</span> } }));

vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Stub the heavy presentational component — this test exercises the page's
// access guards, not the view internals (covered by child-profile-view.test).
vi.mock('@/features/setu/members/child-profile-view', () => ({
  ChildProfileView: ({ profile }: { profile: { firstName: string } }) => (
    <div data-testid="child-profile-view">{profile.firstName}</div>
  ),
}));

// Stub the grade editor — this test asserts WHO the page mounts it for and
// which endpoint it hands them; the editor's own behaviour is covered by
// member-grade-editor.test. `staff` is surfaced because it selects the endpoint,
// so a page that rendered the control with the wrong value would send a
// welcome-team volunteer at the admin-only route and 403.
vi.mock('@/features/setu/rollover/member-grade-editor', () => ({
  MemberGradeEditor: ({ childName, staff }: { childName: string; staff?: boolean }) => (
    <div data-testid="member-grade-editor" data-staff={String(!!staff)}>
      {childName}
    </div>
  ),
}));

// ── Firebase admin (server-only) ─────────────────────────────────────────────
const mockVerifyPortalSessionCookie = vi.hoisted(() =>
  vi.fn(async () => ({ uid: 'wt-1', role: 'welcome-team' })),
);
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  verifyPortalSessionCookie: mockVerifyPortalSessionCookie,
}));

// ── getChildProfile reader ────────────────────────────────────────────────────
const mockGetChildProfile = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-child-profile', () => ({ getChildProfile: mockGetChildProfile }));

// ── Bala Vihar journey reader (server-only Firestore) ─────────────────────────
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: vi.fn(() => ({})) }));
const mockGetChildBalaViharJourney = vi.hoisted(() => vi.fn(async () => []));
vi.mock('@/features/setu/rollover/get-child-journey', () => ({
  getChildBalaViharJourney: mockGetChildBalaViharJourney,
}));

import { WelcomeMemberProfileBody } from '../page';

const PROFILE = {
  mid: 'FAM001-02',
  fid: 'FAM001',
  firstName: 'Priya',
  lastName: 'Patel',
  type: 'Child' as const,
  schoolGrade: 'Grade 3',
  birthMonthYear: null,
  foodAllergies: null,
  programs: [],
  pastPrograms: [],
  stats: { programCount: 0, overallAttendedPct: 0, hasAnyAttendance: false },
};

beforeEach(() => {
  mockCookieGet.mockReset();
  mockCookieGet.mockReturnValue({ value: 'session-cookie' });
  mockVerifyPortalSessionCookie.mockReset();
  mockVerifyPortalSessionCookie.mockResolvedValue({ uid: 'wt-1', role: 'welcome-team' } as never);
  mockGetChildProfile.mockReset();
  mockGetChildProfile.mockResolvedValue(PROFILE);
});

describe('WelcomeMemberProfileBody — happy path', () => {
  it('renders the profile for a welcome-team session when the mid belongs to the fid', async () => {
    const page = await WelcomeMemberProfileBody({ params: Promise.resolve({ fid: 'FAM001', mid: 'FAM001-02' }) });
    render(page as React.ReactElement);
    expect(screen.getAllByTestId('child-profile-view').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Priya').length).toBeGreaterThan(0);
  });
});

describe('WelcomeMemberProfileBody — grade editor gate', () => {
  it('renders the grade editor on the ADMIN endpoint for an admin session', async () => {
    mockVerifyPortalSessionCookie.mockResolvedValueOnce({ uid: 'a-1', role: 'admin' } as never);
    const page = await WelcomeMemberProfileBody({ params: Promise.resolve({ fid: 'FAM001', mid: 'FAM001-02' }) });
    render(page as React.ReactElement);
    const editors = screen.getAllByTestId('member-grade-editor');
    expect(editors.length).toBeGreaterThan(0);
    // Admins keep /api/admin/school-year/set-grade, which is also the rollover
    // preview's path — moving them onto the staff route would be a silent
    // reroute of a working admin surface.
    expect(editors[0]!.getAttribute('data-staff')).toBe('false');
  });

  it('renders the grade editor on the STAFF endpoint for a welcome-team session', async () => {
    // The capability welcome-team was previously missing: the control used to
    // be gated on `admin &&`, so a volunteer never saw it. Repointing the POST
    // target without widening this gate would have been a no-op.
    const page = await WelcomeMemberProfileBody({ params: Promise.resolve({ fid: 'FAM001', mid: 'FAM001-02' }) });
    render(page as React.ReactElement);
    const editors = screen.getAllByTestId('member-grade-editor');
    expect(editors.length).toBeGreaterThan(0);
    expect(editors[0]!.getAttribute('data-staff')).toBe('true');
  });

  // Was "does NOT render the grade editor for a coordinator" - the read-without-
  // edit split from spec 3.1, which the owner reversed on 2026-08-05. The
  // ORIGINAL reasoning still stands and is why this test is kept rather than
  // deleted: rendering a control the route would 403 is the bug. The route no
  // longer 403s for a coordinator, so the control must now appear - and if the
  // inheritance were ever reverted, this test failing is the correct alarm.
  it('DOES render the grade editor for a coordinator - it inherits welcome-team', async () => {
    mockVerifyPortalSessionCookie.mockResolvedValueOnce({ uid: 'c-1', role: 'coordinator' } as never);
    const page = await WelcomeMemberProfileBody({ params: Promise.resolve({ fid: 'FAM001', mid: 'FAM001-02' }) });
    render(page as React.ReactElement);
    const editors = screen.getAllByTestId('member-grade-editor');
    expect(editors.length).toBeGreaterThan(0);
    // `staff` - a coordinator is not an admin, so it saves through the welcome
    // member PATCH, not the admin set-grade route.
    expect(editors[0]!.getAttribute('data-staff')).toBe('true');
    expect(screen.getAllByTestId('child-profile-view').length).toBeGreaterThan(0);
  });

  it('does NOT render the grade editor for an Adult member', async () => {
    // Grade is a child concept; the required-field matrix does not ask adults
    // for one.
    mockGetChildProfile.mockResolvedValueOnce({ ...PROFILE, type: 'Adult' as const });
    const page = await WelcomeMemberProfileBody({ params: Promise.resolve({ fid: 'FAM001', mid: 'FAM001-02' }) });
    render(page as React.ReactElement);
    expect(screen.queryByTestId('member-grade-editor')).toBeNull();
  });
});

describe('WelcomeMemberProfileBody — defense-in-depth role gate', () => {
  it('renders Access denied when the session role is not welcome-team', async () => {
    mockVerifyPortalSessionCookie.mockResolvedValueOnce({ uid: 'fm-1', role: 'family-manager', fid: 'X', mid: 'X-01' } as never);
    const page = await WelcomeMemberProfileBody({ params: Promise.resolve({ fid: 'FAM001', mid: 'FAM001-02' }) });
    render(page as React.ReactElement);
    expect(screen.getByText(/access denied/i)).toBeDefined();
    expect(mockGetChildProfile).not.toHaveBeenCalled();
  });

  it('renders Access denied when verifyPortalSessionCookie returns null', async () => {
    mockVerifyPortalSessionCookie.mockResolvedValueOnce(null as never);
    const page = await WelcomeMemberProfileBody({ params: Promise.resolve({ fid: 'FAM001', mid: 'FAM001-02' }) });
    render(page as React.ReactElement);
    expect(screen.getByText(/access denied/i)).toBeDefined();
    expect(mockGetChildProfile).not.toHaveBeenCalled();
  });
});

describe('WelcomeMemberProfileBody — not found', () => {
  it('throws notFound when the profile is null', async () => {
    mockGetChildProfile.mockResolvedValue(null);
    await expect(
      WelcomeMemberProfileBody({ params: Promise.resolve({ fid: 'FAM001', mid: 'FAM001-99' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('throws notFound when the mid resolves to a DIFFERENT family (fid mismatch / URL tamper)', async () => {
    mockGetChildProfile.mockResolvedValue({ ...PROFILE, fid: 'OTHER-FAM' });
    await expect(
      WelcomeMemberProfileBody({ params: Promise.resolve({ fid: 'FAM001', mid: 'FAM001-02' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
