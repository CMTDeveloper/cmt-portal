import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cacheTag: vi.fn(),
  unstable_cacheLife: vi.fn(),
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
          }),
        },
      ],
    });

    const result = await getFamilyByFid('CMT-AB12CD34');
    const member = result!.members[0]!;
    expect(member.altEmails).toEqual(['priya.work@example.com']);
    expect(member.altPhones).toEqual(['+14165550200']);
    expect(member.contactsNudgeDismissedAt).toEqual(dismissed);
  });
});
