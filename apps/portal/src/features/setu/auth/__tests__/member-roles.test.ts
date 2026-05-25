import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSet, mockGet, mockWhereGet } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockGet: vi.fn(),
  mockWhereGet: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const docRef = {
    get: mockGet,
    set: mockSet,
  };
  const collRef = {
    doc: vi.fn(() => docRef),
    where: vi.fn(() => ({ get: mockWhereGet })),
  };
  return {
    portalFirestore: () => ({
      collection: vi.fn(() => collRef),
    }),
    FieldValue: {
      arrayUnion: (v: unknown) => ({ __arrayUnion: v }),
      arrayRemove: (v: unknown) => ({ __arrayRemove: v }),
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    },
  };
});

import {
  getMemberRoles,
  addMemberRole,
  removeMemberRole,
  listMembersWithRole,
} from '../member-roles';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getMemberRoles', () => {
  it('returns [] when no doc exists', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await getMemberRoles('CMT-X-01')).toEqual([]);
  });

  it('returns the roles array from the doc', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ mid: 'CMT-X-01', fid: 'CMT-X', roles: ['admin', 'welcome-team'] }),
    });
    expect(await getMemberRoles('CMT-X-01')).toEqual(['admin', 'welcome-team']);
  });

  it('filters out unknown role strings', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ mid: 'CMT-X-01', fid: 'CMT-X', roles: ['admin', 'bogus'] }),
    });
    expect(await getMemberRoles('CMT-X-01')).toEqual(['admin']);
  });

  it('handles missing roles field gracefully', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ mid: 'CMT-X-01', fid: 'CMT-X' }),
    });
    expect(await getMemberRoles('CMT-X-01')).toEqual([]);
  });
});

describe('addMemberRole', () => {
  it('writes the doc with arrayUnion + grantedAt/grantedVia', async () => {
    mockSet.mockResolvedValue(undefined);
    await addMemberRole({ mid: 'CMT-X-01', fid: 'CMT-X', role: 'admin', grantedVia: 'me@example.com' });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        mid: 'CMT-X-01',
        fid: 'CMT-X',
        roles: { __arrayUnion: 'admin' },
        grantedAt: 'SERVER_TIMESTAMP',
        grantedVia: 'me@example.com',
      }),
      { merge: true },
    );
  });

  it('writes grantedVia as null when omitted', async () => {
    mockSet.mockResolvedValue(undefined);
    await addMemberRole({ mid: 'CMT-X-01', fid: 'CMT-X', role: 'welcome-team' });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ grantedVia: null }),
      { merge: true },
    );
  });
});

describe('removeMemberRole', () => {
  it('writes arrayRemove with merge so unrelated roles survive', async () => {
    mockSet.mockResolvedValue(undefined);
    await removeMemberRole('CMT-X-01', 'admin');
    expect(mockSet).toHaveBeenCalledWith(
      { roles: { __arrayRemove: 'admin' } },
      { merge: true },
    );
  });
});

describe('listMembersWithRole', () => {
  it('returns array of mid/fid/grantedVia from query snapshot', async () => {
    mockWhereGet.mockResolvedValue({
      docs: [
        { data: () => ({ mid: 'CMT-A-01', fid: 'CMT-A', grantedVia: 'a@example.com' }) },
        { data: () => ({ mid: 'CMT-B-01', fid: 'CMT-B', grantedVia: null }) },
      ],
    });
    const out = await listMembersWithRole('admin');
    expect(out).toEqual([
      { mid: 'CMT-A-01', fid: 'CMT-A', grantedVia: 'a@example.com' },
      { mid: 'CMT-B-01', fid: 'CMT-B', grantedVia: null },
    ]);
  });
});
