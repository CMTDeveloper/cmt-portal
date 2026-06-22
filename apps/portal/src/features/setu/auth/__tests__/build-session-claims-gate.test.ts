import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sign-in gate (Task 4): a matched member whose portalAccess === 'pending'
// (non-manager) is "gated" — buildSessionClaimsForContact recognizes the
// family/member but does NOT mint family claims, returning the pendingApproval
// signal instead. Managers and active/absent members are unaffected.

const { mockGetUser, mockCreateUser, mockFind, mockGetMemberRoles, mockIsTeacherAssigned } =
  vi.hoisted(() => ({
    mockGetUser: vi.fn(),
    mockCreateUser: vi.fn(),
    mockFind: vi.fn(),
    mockGetMemberRoles: vi.fn(),
    mockIsTeacherAssigned: vi.fn(),
  }));

vi.mock('@/features/check-in/shared', () => ({ sha256Hex: (s: string) => `uid-${s}` }));
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: () => ({ getUser: mockGetUser, createUser: mockCreateUser }),
}));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ collectionGroup: () => ({ where: () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }) }) }) }),
}));
vi.mock('@cmt/shared-domain/setu', () => ({ normalizeContactForKey: (_t: string, v: string) => v }));
vi.mock('../find-family-by-contact', () => ({ findSetuFamilyByContact: mockFind }));
vi.mock('../member-roles', () => ({ getMemberRoles: mockGetMemberRoles }));
vi.mock('@/features/setu/teacher/assignments', () => ({ isTeacherAssigned: mockIsTeacherAssigned }));

const mockLazyMigrate = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/registration/lazy-migrate', () => ({ lazyMigrateLegacyFamily: mockLazyMigrate }));

import {
  buildSessionClaimsForContact,
  hasSession,
  isPendingApproval,
} from '../build-session-claims';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ customClaims: {} });
  mockGetMemberRoles.mockResolvedValue([]);
  mockIsTeacherAssigned.mockResolvedValue(false);
  mockLazyMigrate.mockResolvedValue(undefined);
});

describe('build-session-claims — sign-in gate (pending members)', () => {
  it('gated member (portalAccess pending, non-manager) → pendingApproval, NO family claims', async () => {
    mockFind.mockResolvedValue({
      source: 'setu',
      fid: 'CMT-FAM1',
      mid: 'CMT-FAM1-03',
      legacyFid: null,
      member: { manager: false, portalAccess: 'pending' },
    });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'pending@example.com',
      contactProvenance: 'otp',
    });

    expect(isPendingApproval(res)).toBe(true);
    expect(hasSession(res)).toBe(false);
    if (!isPendingApproval(res)) return;
    expect(res.pendingFid).toBe('CMT-FAM1');
    expect(res.pendingMatchedMid).toBe('CMT-FAM1-03');
    // No claims object at all.
    expect('claims' in res).toBe(false);
    expect('uid' in res).toBe(false);
  });

  it('manager is NOT gated even with portalAccess pending → normal family-manager claims', async () => {
    mockFind.mockResolvedValue({
      source: 'setu',
      fid: 'CMT-FAM1',
      mid: 'CMT-FAM1-01',
      legacyFid: null,
      member: { manager: true, portalAccess: 'pending' },
    });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'manager@example.com',
      contactProvenance: 'otp',
    });

    expect(isPendingApproval(res)).toBe(false);
    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    expect(res.claims.role).toBe('family-manager');
    expect(res.redirectTo).toBe('/family');
  });

  it('active member (portalAccess active) → normal family-member claims', async () => {
    mockFind.mockResolvedValue({
      source: 'setu',
      fid: 'CMT-FAM1',
      mid: 'CMT-FAM1-02',
      legacyFid: null,
      member: { manager: false, portalAccess: 'active' },
    });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'active@example.com',
      contactProvenance: 'otp',
    });

    expect(isPendingApproval(res)).toBe(false);
    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    expect(res.claims.role).toBe('family-member');
  });

  it('member WITHOUT portalAccess (absent ⇒ active) → normal family-member claims', async () => {
    mockFind.mockResolvedValue({
      source: 'setu',
      fid: 'CMT-FAM1',
      mid: 'CMT-FAM1-02',
      legacyFid: null,
      member: { manager: false },
    });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'absent@example.com',
      contactProvenance: 'otp',
    });

    expect(isPendingApproval(res)).toBe(false);
    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    expect(res.claims.role).toBe('family-member');
  });

  it('freshly lazy-migrated non-primary adult (pending) → pendingApproval, no claims', async () => {
    // Legacy hit first; post-migration re-lookup returns a gated pending member.
    mockFind
      .mockResolvedValueOnce({ source: 'legacy', fid: null, mid: null, legacyFid: '42', member: undefined })
      .mockResolvedValueOnce({
        source: 'setu',
        fid: 'CMT-FAMNEW',
        mid: 'CMT-FAMNEW-03',
        legacyFid: '42',
        member: { manager: false, portalAccess: 'pending' },
      });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'second.adult@example.com',
      contactProvenance: 'otp',
    });

    expect(isPendingApproval(res)).toBe(true);
    if (!isPendingApproval(res)) return;
    expect(res.pendingFid).toBe('CMT-FAMNEW');
    expect(res.pendingMatchedMid).toBe('CMT-FAMNEW-03');
    expect(mockLazyMigrate).toHaveBeenCalledWith('42');
  });

  it('a pending member who is ALSO a sevak (welcome-team) is NOT gated (keeps family resolution)', async () => {
    mockFind.mockResolvedValue({
      source: 'setu',
      fid: 'CMT-FAM1',
      mid: 'CMT-FAM1-04',
      legacyFid: null,
      member: { manager: false, portalAccess: 'pending' },
    });
    mockGetMemberRoles.mockResolvedValue(['welcome-team']);

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'sevak-pending@example.com',
      contactProvenance: 'otp',
    });

    // Sevak access must not be locked out by a pending family flag.
    expect(isPendingApproval(res)).toBe(false);
    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    expect(res.claims.role).toBe('family-member');
    expect(res.claims.extraRoles).toEqual(['welcome-team']);
  });
});
