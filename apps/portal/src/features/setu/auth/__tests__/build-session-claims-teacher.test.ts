import { describe, it, expect, vi, beforeEach } from 'vitest';

// Focused on the teacher-capability merge added in Slice 4a: a parent who is
// assigned to a level gains 'teacher' in extraRoles while keeping their family
// primary role.

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
vi.mock('@/features/setu/registration/lazy-migrate', () => ({ lazyMigrateLegacyFamily: vi.fn() }));

import { buildSessionClaimsForContact, hasSession } from '../build-session-claims';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ customClaims: {} });
  mockGetMemberRoles.mockResolvedValue([]);
  mockIsTeacherAssigned.mockResolvedValue(false);
});

const SETU_MANAGER = {
  source: 'setu' as const,
  fid: 'CMT-FAM1',
  mid: 'CMT-FAM1-01',
  legacyFid: null,
  member: { manager: true },
};

describe('build-session-claims — teacher capability merge', () => {
  it('adds teacher to extraRoles for an assigned parent-manager', async () => {
    mockFind.mockResolvedValue(SETU_MANAGER);
    mockIsTeacherAssigned.mockResolvedValue(true);

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'asha@example.com',
      contactProvenance: 'otp',
    });

    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    expect(res.claims.role).toBe('family-manager');
    expect(res.claims.extraRoles).toEqual(['teacher']);
    expect(res.redirectTo).toBe('/family');
    expect(mockIsTeacherAssigned).toHaveBeenCalledWith('CMT-FAM1-01');
  });

  it('omits teacher when the member is not assigned to any level', async () => {
    mockFind.mockResolvedValue(SETU_MANAGER);
    mockIsTeacherAssigned.mockResolvedValue(false);

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'noteacher@example.com',
      contactProvenance: 'otp',
    });

    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    expect(res.claims.role).toBe('family-manager');
    expect(res.claims.extraRoles).toBeUndefined();
  });

  it('does not duplicate teacher into extras for an admin (admin inherits teacher)', async () => {
    mockFind.mockResolvedValue(SETU_MANAGER);
    mockGetMemberRoles.mockResolvedValue(['admin']);
    mockIsTeacherAssigned.mockResolvedValue(true);

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'adminteacher@example.com',
      contactProvenance: 'otp',
    });

    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    // admin present, teacher NOT pushed (isTeacher already true via admin)
    expect(res.claims.extraRoles).toEqual(['admin']);
  });
});
