import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetUser, mockSetClaims, mockRevoke } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSetClaims: vi.fn(),
  mockRevoke: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: () => ({
    getUser: mockGetUser,
    setCustomUserClaims: mockSetClaims,
    revokeRefreshTokens: mockRevoke,
  }),
}));
vi.mock('@/features/check-in/shared', () => ({ sha256Hex: (s: string) => `uid:${s}` }));
vi.mock('@cmt/shared-domain/setu', () => ({
  // real normalizer lowercases emails; identity is fine for the phone case here
  normalizeContactForKey: (_t: string, v: string) => v.toLowerCase(),
}));

import { revokeMemberSessions, revokeUidSessions } from '../revoke-sessions';

beforeEach(() => {
  vi.clearAllMocks();
  mockSetClaims.mockResolvedValue(undefined);
  mockRevoke.mockResolvedValue(undefined);
});

describe('revokeUidSessions', () => {
  it('revokes the uid', async () => {
    await revokeUidSessions('uid-1');
    expect(mockRevoke).toHaveBeenCalledWith('uid-1');
  });

  it('swallows auth/user-not-found', async () => {
    mockRevoke.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    await expect(revokeUidSessions('uid-x')).resolves.toBeUndefined();
  });

  it('rethrows other errors', async () => {
    mockRevoke.mockRejectedValueOnce({ code: 'boom' });
    await expect(revokeUidSessions('uid-x')).rejects.toEqual({ code: 'boom' });
  });
});

describe('revokeMemberSessions', () => {
  it('revokes BOTH the email and phone uids and reads no claims without stripCaps', async () => {
    const res = await revokeMemberSessions({ email: 'A@X.com', phone: '+1613' });
    expect(mockRevoke).toHaveBeenCalledWith('uid:a@x.com');
    expect(mockRevoke).toHaveBeenCalledWith('uid:+1613');
    expect(mockRevoke).toHaveBeenCalledTimes(2);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(res.uids).toEqual(['uid:a@x.com', 'uid:+1613']);
  });

  it('is a no-op with no contacts', async () => {
    const res = await revokeMemberSessions({ email: null, phone: null });
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(res.uids).toEqual([]);
  });

  it('strips the given capability from persisted claims before revoking', async () => {
    mockGetUser.mockResolvedValue({
      customClaims: { role: 'family-manager', extraRoles: ['admin'], fid: 'F', mid: 'M' },
    });
    await revokeMemberSessions({ email: 'a@x.com', stripCaps: ['admin'] });
    expect(mockSetClaims).toHaveBeenCalledTimes(1);
    const [uid, claims] = mockSetClaims.mock.calls[0]!;
    expect(uid).toBe('uid:a@x.com');
    expect(claims.extraRoles).toBeUndefined(); // admin removed → extras emptied
    expect(claims.role).toBe('family-manager'); // primary preserved
    expect(mockRevoke).toHaveBeenCalledWith('uid:a@x.com');
  });

  it('does not write claims when the capability is absent', async () => {
    mockGetUser.mockResolvedValue({ customClaims: { role: 'family-member', fid: 'F', mid: 'M' } });
    await revokeMemberSessions({ email: 'a@x.com', stripCaps: ['admin'] });
    expect(mockSetClaims).not.toHaveBeenCalled();
    expect(mockRevoke).toHaveBeenCalledWith('uid:a@x.com');
  });

  it('still revokes when the auth user does not exist (strip swallows not-found)', async () => {
    mockGetUser.mockRejectedValue({ code: 'auth/user-not-found' });
    await revokeMemberSessions({ email: 'a@x.com', stripCaps: ['admin'] });
    expect(mockSetClaims).not.toHaveBeenCalled();
    expect(mockRevoke).toHaveBeenCalledWith('uid:a@x.com');
  });

  it('dedupes when email and phone normalize to the same uid', async () => {
    await revokeMemberSessions({ email: 'same', phone: 'same' });
    expect(mockRevoke).toHaveBeenCalledTimes(1);
  });
});
