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

// ── Firebase admin (server-only) ─────────────────────────────────────────────
const mockVerifyPortalSessionCookie = vi.hoisted(() =>
  vi.fn(async () => ({ uid: 'wt-1', role: 'welcome-team' })),
);
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  verifyPortalSessionCookie: mockVerifyPortalSessionCookie,
}));

const mockGetFamilyByFid = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-family-by-fid', () => ({ getFamilyByFid: mockGetFamilyByFid }));

// Stub the client wrapper. This suite is about the page's GATE and the shape it
// hands down - the form's own behaviour has 29 tests of its own on the family
// screen, and re-testing it here would only pin the stub.
vi.mock('@/features/setu/members/staff-member-edit-client', () => ({
  StaffMemberEditClient: ({
    fid,
    mid,
    initial,
  }: {
    fid: string;
    mid: string;
    initial: Record<string, unknown>;
  }) => (
    <div
      data-testid="staff-member-edit"
      data-fid={fid}
      data-mid={mid}
      data-initial={JSON.stringify(initial)}
    />
  ),
}));

import { WelcomeMemberEditBody } from '../page';

const FID = 'CMT-AB12CD34';
const MID = `${FID}-02`;

function member(overrides: Record<string, unknown> = {}) {
  return {
    mid: MID,
    firstName: 'Divina',
    lastName: 'Matta',
    type: 'Child',
    gender: 'Female',
    schoolGrade: 'Grade 2',
    birthMonthYear: '2019-08',
    foodAllergies: 'None',
    email: null,
    phone: null,
    volunteeringSkills: [],
    manager: false,
    ...overrides,
  };
}

function seed(members: Array<Record<string, unknown>> = [member()]) {
  mockGetFamilyByFid.mockResolvedValue({ family: { fid: FID, name: 'Matta' }, members });
}

const params = Promise.resolve({ fid: FID, mid: MID });

beforeEach(() => {
  vi.clearAllMocks();
  mockCookieGet.mockReturnValue({ value: 'session-cookie' });
  mockVerifyPortalSessionCookie.mockResolvedValue({ uid: 'wt-1', role: 'welcome-team' } as never);
  seed();
});

describe('WelcomeMemberEditBody - the page gate', () => {
  it('renders the form for welcome-team', async () => {
    const page = await WelcomeMemberEditBody({ params });
    render(page as React.ReactElement);
    expect(screen.getByTestId('staff-member-edit')).toBeTruthy();
  });

  // Gate 2 of three. Middleware is gate 1 and the PATCH handler is gate 3;
  // this asserts the page does not simply trust the first of them.
  it('renders Access denied for a family role, not the form', async () => {
    mockVerifyPortalSessionCookie.mockResolvedValueOnce({ uid: 'f-1', role: 'family-manager' } as never);
    const page = await WelcomeMemberEditBody({ params });
    render(page as React.ReactElement);
    expect(screen.queryByTestId('staff-member-edit')).toBeNull();
    expect(screen.getByText(/Access denied/i)).toBeTruthy();
  });

  it('renders Access denied when there is no session at all', async () => {
    mockVerifyPortalSessionCookie.mockResolvedValueOnce(null as never);
    const page = await WelcomeMemberEditBody({ params });
    render(page as React.ReactElement);
    expect(screen.queryByTestId('staff-member-edit')).toBeNull();
  });

  // Coordinator inherits welcome-team as of 2026-08-05. If the inheritance is
  // ever reverted, this failing is the correct alarm.
  it('renders the form for a coordinator - it inherits welcome-team', async () => {
    mockVerifyPortalSessionCookie.mockResolvedValueOnce({ uid: 'c-1', role: 'coordinator' } as never);
    const page = await WelcomeMemberEditBody({ params });
    render(page as React.ReactElement);
    expect(screen.getByTestId('staff-member-edit')).toBeTruthy();
  });

  it('404s when the mid does not belong to the route fid (URL tampering)', async () => {
    seed([member({ mid: `${FID}-99` })]);
    await expect(WelcomeMemberEditBody({ params })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s when the family does not exist', async () => {
    mockGetFamilyByFid.mockResolvedValue(null);
    await expect(WelcomeMemberEditBody({ params })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('WelcomeMemberEditBody - the shape handed to the form', () => {
  // N=2: the family has two members and the page must seed the one named in the
  // route. A single-member fixture passes even if the page takes members[0],
  // which is the bug this codebase has hit repeatedly on one-to-many reads.
  it('seeds the member named in the route, not the first one', async () => {
    seed([
      member({ mid: `${FID}-01`, firstName: 'Dinesh', type: 'Adult', manager: true }),
      member({ mid: MID, firstName: 'Divina' }),
    ]);
    const page = await WelcomeMemberEditBody({ params });
    render(page as React.ReactElement);
    const initial = JSON.parse(screen.getByTestId('staff-member-edit').getAttribute('data-initial')!);
    expect(initial.mid).toBe(MID);
    expect(initial.firstName).toBe('Divina');
  });

  it('carries every field the form initialises from', async () => {
    seed([
      member({
        type: 'Adult',
        gender: 'Male',
        email: 'a@b.com',
        phone: '416-555-0100',
        volunteeringSkills: ['Teaching'],
        manager: true,
        foodAllergies: 'nuts',
      }),
    ]);
    const page = await WelcomeMemberEditBody({ params });
    render(page as React.ReactElement);
    const initial = JSON.parse(screen.getByTestId('staff-member-edit').getAttribute('data-initial')!);
    // Asserted as a whole object rather than field-by-field: a hand-written
    // projection that silently drops a NEW field is the failure mode this
    // codebase has recorded before, and a per-field check cannot see an
    // omission it was not told to look for.
    expect(initial).toEqual({
      mid: MID,
      firstName: 'Divina',
      lastName: 'Matta',
      type: 'Adult',
      gender: 'Male',
      schoolGrade: 'Grade 2',
      birthMonthYear: '2019-08',
      foodAllergies: 'nuts',
      email: 'a@b.com',
      phone: '416-555-0100',
      volunteeringSkills: ['Teaching'],
      manager: true,
    });
  });

  // exactOptionalPropertyTypes: participation is OMITTED when active rather
  // than sent as undefined, and the form reads absent as active.
  it('omits participation for an active member and passes it for an inactive one', async () => {
    seed([member({ participation: 'active' })]);
    let page = await WelcomeMemberEditBody({ params });
    const { unmount } = render(page as React.ReactElement);
    let initial = JSON.parse(screen.getByTestId('staff-member-edit').getAttribute('data-initial')!);
    expect('participation' in initial).toBe(false);
    unmount();

    seed([member({ participation: 'inactive' })]);
    page = await WelcomeMemberEditBody({ params });
    render(page as React.ReactElement);
    initial = JSON.parse(screen.getByTestId('staff-member-edit').getAttribute('data-initial')!);
    expect(initial.participation).toBe('inactive');
  });
});
