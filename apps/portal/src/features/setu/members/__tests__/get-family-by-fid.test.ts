import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));

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

import { getFamilyByFid } from '../get-family-by-fid';

beforeEach(() => {
  vi.clearAllMocks();
  mockFamilyGet.mockResolvedValue({
    exists: true,
    data: () => ({
      fid: 'CMT-AB12CD34',
      legacyFid: null,
      name: 'Patel',
      location: 'Brampton',
      createdAt: { toDate: () => new Date() },
      managers: ['CMT-AB12CD34-01'],
      searchKeys: ['patel'],
    }),
  });
});

describe('getFamilyByFid — multi-contact defaults', () => {
  it('defaults altEmails/altPhones to [] and contactsNudgeDismissedAt to null', async () => {
    mockMembersGet.mockResolvedValue({
      docs: [
        {
          data: () => ({
            mid: 'CMT-AB12CD34-01',
            firstName: 'Raj',
            lastName: 'Patel',
            type: 'Adult',
            gender: 'Male',
            manager: true,
            joinedAt: { toDate: () => new Date() },
            email: 'raj@example.com',
            phone: '+14165551234',
            // NOTE: no altEmails / altPhones / contactsNudgeDismissedAt on this
            // (pre-Phase-B) doc.
          }),
        },
      ],
    });

    const result = await getFamilyByFid('CMT-AB12CD34');
    const member = result!.members[0]!;
    expect(member.altEmails).toEqual([]);
    expect(member.altPhones).toEqual([]);
    expect(member.contactsNudgeDismissedAt).toBeNull();
    expect(member.volunteeringSkillsNudgeDismissedAt).toBeNull();
  });

  it('passes through stored altEmails/altPhones and a dismissed timestamp', async () => {
    const dismissed = new Date('2026-06-05T00:00:00Z');
    mockMembersGet.mockResolvedValue({
      docs: [
        {
          data: () => ({
            mid: 'CMT-AB12CD34-02',
            firstName: 'Priya',
            lastName: 'Patel',
            type: 'Adult',
            gender: 'Female',
            manager: false,
            joinedAt: { toDate: () => new Date() },
            email: 'priya@example.com',
            phone: null,
            altEmails: ['priya.work@example.com'],
            altPhones: ['+14165550200'],
            contactsNudgeDismissedAt: { toDate: () => dismissed },
            volunteeringSkillsNudgeDismissedAt: { toDate: () => dismissed },
          }),
        },
      ],
    });

    const result = await getFamilyByFid('CMT-AB12CD34');
    const member = result!.members[0]!;
    expect(member.altEmails).toEqual(['priya.work@example.com']);
    expect(member.altPhones).toEqual(['+14165550200']);
    expect(member.contactsNudgeDismissedAt).toEqual(dismissed);
    expect(member.volunteeringSkillsNudgeDismissedAt).toEqual(dismissed);
  });

  // Regression: this hand-map is the REAL data source for /family + the gate. A
  // deployed-UAT E2E caught inviteStatus being dropped here (a pending co-manager
  // rendered as a normal member, no "Invite pending" badge). Keep it mapped.
  // Same class of defect as inviteStatus above, for the centre-confirmation
  // flag. This hand-map has no spread, so a field added to FamilyDocSchema but
  // not to the map is `undefined` forever - the profile gate and
  // /complete-profile would both read it as "nothing to confirm" and the family
  // would stay silently filed under the defaulted Brampton. Asserted against
  // getFamilyByFid itself, NOT a mocked gate, because a mocked-gate test passes
  // green against exactly the inert wiring this guards.
  it('round-trips locationNeedsConfirmation from the Firestore doc', async () => {
    mockFamilyGet.mockResolvedValue({
      exists: true,
      data: () => ({
        fid: 'CMT-AB12CD34',
        legacyFid: '1016',
        name: 'Patel',
        location: 'Brampton',
        createdAt: { toDate: () => new Date() },
        managers: ['CMT-AB12CD34-01'],
        searchKeys: ['patel'],
        locationNeedsConfirmation: true,
      }),
    });
    mockMembersGet.mockResolvedValue({ docs: [] });

    const result = await getFamilyByFid('CMT-AB12CD34');
    expect(result!.family.locationNeedsConfirmation).toBe(true);
  });

  it('defaults locationNeedsConfirmation to null for a family that never had it', async () => {
    mockMembersGet.mockResolvedValue({ docs: [] });
    const result = await getFamilyByFid('CMT-AB12CD34');
    expect(result!.family.locationNeedsConfirmation).toBeNull();
  });

  it('maps inviteStatus for a pending co-manager, and defaults it to null when absent', async () => {
    mockMembersGet.mockResolvedValue({
      docs: [
        { data: () => ({ mid: 'CMT-AB12CD34-01', firstName: 'Raj', lastName: 'Patel', type: 'Adult', gender: 'Male', manager: true, joinedAt: { toDate: () => new Date() }, email: 'raj@example.com', phone: null }) },
        { data: () => ({ mid: 'CMT-AB12CD34-03', firstName: 'Bob', lastName: 'Jones', type: 'Adult', gender: 'PreferNotToSay', manager: true, joinedAt: { toDate: () => new Date() }, email: 'bob@example.com', phone: null, inviteStatus: 'pending' }) },
      ],
    });
    const result = await getFamilyByFid('CMT-AB12CD34');
    expect(result!.members[0]!.inviteStatus ?? null).toBeNull(); // absent ⇒ active
    expect(result!.members[1]!.inviteStatus).toBe('pending');
  });
});

// ── The hand-map, which is where this whole feature lives or dies ────────────
//
// This function does NOT parse member docs with MemberDocSchema. It hand-maps
// them field by field and closes with `as MemberDoc`, so a field added to the
// schema and honoured in the shared gate helper still arrives here as
// `undefined` - correct-looking code, green tests, family still stuck. The type
// assertion is exactly why the compiler will not say a word. Two comments from
// two earlier people sit in that file for the same reason
// (`locationNeedsConfirmation`, `inviteStatus`); these are the tests that
// should have come with them.
describe('getFamilyByFid — participation survives the hand-map', () => {
  const memberDoc = (over: Record<string, unknown> = {}) => ({
    data: () => ({
      mid: 'CMT-AB12CD34-02',
      firstName: 'Archish',
      lastName: 'S',
      type: 'Child',
      gender: 'Male',
      manager: false,
      joinedAt: { toDate: () => new Date() },
      ...over,
    }),
  });

  it('carries a retired member through as inactive', async () => {
    const inactiveAt = new Date('2026-08-02T12:00:00Z');
    mockMembersGet.mockResolvedValue({
      docs: [memberDoc({ participation: 'inactive', inactiveAt: { toDate: () => inactiveAt }, inactiveSource: 'family' })],
    });
    const m = (await getFamilyByFid('CMT-AB12CD34'))!.members[0]!;
    expect(m.participation).toBe('inactive');
    expect(m.inactiveAt).toEqual(inactiveAt);
    expect(m.inactiveSource).toBe('family');
  });

  it('defaults an ABSENT participation to active — all 2033 migrated docs predate the field', async () => {
    // The one that would empty the school if it went the other way.
    mockMembersGet.mockResolvedValue({ docs: [memberDoc()] });
    const m = (await getFamilyByFid('CMT-AB12CD34'))!.members[0]!;
    expect(m.participation).toBe('active');
    expect(m.inactiveAt).toBeNull();
    expect(m.inactiveSource).toBeNull();
    expect(m.graduatedAt).toBeNull();
  });

  it('carries graduatedAt, which the school-year rollover stamps', async () => {
    const graduatedAt = new Date('2026-06-30T00:00:00Z');
    mockMembersGet.mockResolvedValue({ docs: [memberDoc({ graduatedAt: { toDate: () => graduatedAt } })] });
    expect((await getFamilyByFid('CMT-AB12CD34'))!.members[0]!.graduatedAt).toEqual(graduatedAt);
  });
});
