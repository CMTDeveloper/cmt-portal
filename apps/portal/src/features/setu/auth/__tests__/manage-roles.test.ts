import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetUser,
  mockCreateUser,
  mockSetCustomUserClaims,
  mockFind,
  mockAddMemberRole,
  mockRemoveMemberRole,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockCreateUser: vi.fn(),
  mockSetCustomUserClaims: vi.fn(),
  mockFind: vi.fn(),
  mockAddMemberRole: vi.fn(),
  mockRemoveMemberRole: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/check-in/shared', () => ({ sha256Hex: (s: string) => `uid-${s}` }));
vi.mock('@cmt/shared-domain/setu', () => ({
  normalizeContactForKey: (_t: string, v: string) => v,
}));
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: () => ({
    getUser: mockGetUser,
    createUser: mockCreateUser,
    setCustomUserClaims: mockSetCustomUserClaims,
  }),
}));
vi.mock('../find-family-by-contact', () => ({ findSetuFamilyByContact: mockFind }));
vi.mock('../member-roles', () => ({
  addMemberRole: mockAddMemberRole,
  removeMemberRole: mockRemoveMemberRole,
}));

import { grantRole, revokeRole } from '../manage-roles';

const SETU_FAMILY = {
  source: 'setu' as const,
  fid: 'CMT-FAM1',
  mid: 'CMT-FAM1-01',
  legacyFid: null,
  family: null,
};

const NO_FAMILY = {
  source: null,
  fid: null,
  mid: null,
  legacyFid: null,
  family: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAddMemberRole.mockResolvedValue(undefined);
  mockRemoveMemberRole.mockResolvedValue(undefined);
  mockSetCustomUserClaims.mockResolvedValue(undefined);
  mockCreateUser.mockResolvedValue(undefined);
});

describe('grantRole — family (roleAssignments) path', () => {
  it('grants welcome-team to a family contact via addMemberRole', async () => {
    mockFind.mockResolvedValue(SETU_FAMILY);

    const res = await grantRole({ contact: 'asha@example.com', role: 'welcome-team' });

    expect(mockAddMemberRole).toHaveBeenCalledWith({
      mid: 'CMT-FAM1-01',
      fid: 'CMT-FAM1',
      role: 'welcome-team',
      grantedVia: 'asha@example.com',
    });
    expect(res).toEqual({
      path: 'roleAssignments',
      mid: 'CMT-FAM1-01',
      fid: 'CMT-FAM1',
      uid: null,
    });
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });
});

describe('grantRole — non-family (auth-claim) path', () => {
  it('rejects a non-family contact when the auth user is missing', async () => {
    mockFind.mockResolvedValue(NO_FAMILY);
    mockGetUser.mockRejectedValue({ code: 'auth/user-not-found' });

    await expect(grantRole({ contact: 'staff@example.com', role: 'admin' })).rejects.toThrow(
      'registered-user-required',
    );

    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('reuses an existing auth user (no createUser) and stacks the capability', async () => {
    mockFind.mockResolvedValue(NO_FAMILY);
    mockGetUser.mockResolvedValue({ customClaims: { role: 'welcome-team' } });

    await grantRole({ contact: 'staff@example.com', role: 'admin' });

    expect(mockCreateUser).not.toHaveBeenCalled();
    const [, claims] = mockSetCustomUserClaims.mock.calls[0]!;
    // admin promoted to primary, welcome-team pushed to extras (role-claims rule)
    expect(claims.role).toBe('admin');
    expect(claims.extraRoles).toEqual(['welcome-team']);
  });
});

describe('revokeRole — family (roleAssignments) path', () => {
  it('removes the role from the member assignment', async () => {
    mockFind.mockResolvedValue(SETU_FAMILY);

    const res = await revokeRole({ contact: 'asha@example.com', role: 'welcome-team' });

    expect(mockRemoveMemberRole).toHaveBeenCalledWith('CMT-FAM1-01', 'welcome-team');
    expect(res).toEqual({ path: 'roleAssignments', revoked: true });
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });
});

describe('revokeRole — non-family (auth-claim) path', () => {
  it('removes the capability when the claim is present', async () => {
    mockFind.mockResolvedValue(NO_FAMILY);
    mockGetUser.mockResolvedValue({ customClaims: { role: 'admin' } });

    const res = await revokeRole({ contact: 'staff@example.com', role: 'admin' });

    expect(mockSetCustomUserClaims).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ path: 'auth-claim', revoked: true });
  });

  it('returns revoked:false when the claim is absent', async () => {
    mockFind.mockResolvedValue(NO_FAMILY);
    mockGetUser.mockResolvedValue({ customClaims: { role: 'family-member' } });

    const res = await revokeRole({ contact: 'staff@example.com', role: 'admin' });

    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    expect(res).toEqual({ path: 'auth-claim', revoked: false });
  });

  it('returns revoked:false when the auth user does not exist', async () => {
    mockFind.mockResolvedValue(NO_FAMILY);
    mockGetUser.mockRejectedValue({ code: 'auth/user-not-found' });

    const res = await revokeRole({ contact: 'staff@example.com', role: 'admin' });

    expect(res).toEqual({ path: 'auth-claim', revoked: false });
  });
});
