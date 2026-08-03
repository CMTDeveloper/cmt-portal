import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The THIRD hand-written member projection (after `getFamilyByFid` and
 * `promote-families.mapMembers`), and the one behind `/welcome/family/[fid]`.
 *
 * Like the others it has no spread and closes with `as MemberDoc`, so a field
 * left out is `undefined` forever regardless of what MemberDocSchema says - and
 * the compiler stays silent because of that assertion. The failure it produces
 * is quiet and expensive: the welcome team sees a member the family has retired
 * as a perfectly normal one, and chases them for the details the portal has
 * just promised to stop asking for.
 */

const mockFamilyGet = vi.fn();
const mockMembersGet = vi.fn();

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: () => ({
      doc: () => ({
        get: mockFamilyGet,
        collection: () => ({ get: mockMembersGet }),
      }),
    }),
  }),
}));

const verifyPortalSessionCookie = vi.hoisted(() => vi.fn());
vi.mock('@cmt/firebase-shared/admin/session', () => ({ verifyPortalSessionCookie }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'cookie' }) }),
}));

import { getFamilyForWelcome } from '../get-family-for-welcome';

const FID = 'CMT-AB12CD34';

beforeEach(() => {
  vi.clearAllMocks();
  // A welcome-team session; the function re-verifies the role defensively.
  verifyPortalSessionCookie.mockResolvedValue({
    uid: 'uid-1',
    role: 'welcome-team',
    extraRoles: [],
  });
  mockFamilyGet.mockResolvedValue({
    exists: true,
    data: () => ({
      fid: FID,
      legacyFid: null,
      name: 'Patel',
      location: 'Brampton',
      createdAt: { toDate: () => new Date() },
      managers: [`${FID}-01`],
      searchKeys: ['patel'],
    }),
  });
});

const memberDoc = (over: Record<string, unknown> = {}) => ({
  data: () => ({
    mid: `${FID}-02`,
    firstName: 'Archish',
    lastName: 'S',
    type: 'Child',
    gender: 'Male',
    manager: false,
    joinedAt: { toDate: () => new Date() },
    ...over,
  }),
});

describe('getFamilyForWelcome — participation survives the hand-map', () => {
  it('shows the welcome team that a member has been retired', async () => {
    const inactiveAt = new Date('2026-08-02T12:00:00Z');
    mockMembersGet.mockResolvedValue({
      docs: [
        memberDoc({
          participation: 'inactive',
          inactiveAt: { toDate: () => inactiveAt },
          inactiveSource: 'family',
        }),
      ],
    });

    const result = await getFamilyForWelcome(FID);
    const m = result!.members[0]!;
    expect(m.participation).toBe('inactive');
    expect(m.inactiveAt).toEqual(inactiveAt);
    expect(m.inactiveSource).toBe('family');
  });

  it('defaults an ABSENT participation to active', async () => {
    // Every migrated member doc predates the field. Read the other way round,
    // the welcome team would see the entire roster as retired.
    mockMembersGet.mockResolvedValue({ docs: [memberDoc()] });
    const m = (await getFamilyForWelcome(FID))!.members[0]!;
    expect(m.participation).toBe('active');
    expect(m.inactiveAt).toBeNull();
    expect(m.graduatedAt).toBeNull();
  });

  it('distinguishes a family-retired member from a migration-retired one (N=2)', async () => {
    // `inactiveSource` is the difference between "the family told us" and "the
    // legacy roster had no level for them". Staff need to know which, because
    // only the second is a guess the portal made on their behalf.
    mockMembersGet.mockResolvedValue({
      docs: [
        memberDoc({ mid: `${FID}-02`, participation: 'inactive', inactiveSource: 'family' }),
        memberDoc({ mid: `${FID}-03`, participation: 'inactive', inactiveSource: 'legacy-migration' }),
      ],
    });
    const members = (await getFamilyForWelcome(FID))!.members;
    expect(members.map((m) => m.inactiveSource)).toEqual(['family', 'legacy-migration']);
  });
});
