import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression: the generic kiosk-tablet account (custom claim role:'kiosk', no
// family/member) must get a real session on password/OTP sign-in. Before the
// fix, buildSessionClaimsForContact had no isKioskUser branch, so a kiosk
// account fell through to { redirectTo: '/register' } with NO session - the
// tablet could never authorize a check-in. (Found via a deployed-UAT sign-in
// walkthrough; unit mocks alone missed it.)

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
  mockFind.mockResolvedValue({ source: null });
});

describe('build-session-claims - kiosk role', () => {
  it('mints a kiosk session for a family-less account carrying the kiosk claim', async () => {
    mockGetUser.mockResolvedValue({ customClaims: { role: 'kiosk' } });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'kiosk-tablet@chinmayatoronto.org',
      contactProvenance: 'password',
    });

    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    expect(res.claims.role).toBe('kiosk');
    expect(res.claims.email).toBe('kiosk-tablet@chinmayatoronto.org');
    expect(res.claims.fid).toBeUndefined();
    expect(res.redirectTo).toBe('/check-in');
  });

  it('mints a kiosk session when kiosk is carried ONLY in extraRoles', async () => {
    // No primary role - kiosk lives only in extraRoles. If the extraRoles read
    // were dropped, allExistingRoles would be empty and this would fall through
    // to the register redirect, so this genuinely exercises the extraRoles path.
    mockGetUser.mockResolvedValue({ customClaims: { extraRoles: ['kiosk'] } });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'kiosk-tablet@chinmayatoronto.org',
      contactProvenance: 'password',
    });

    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    expect(res.claims.role).toBe('kiosk');
    expect(res.redirectTo).toBe('/check-in');
  });

  it('admin still wins over kiosk (admin inherits kiosk)', async () => {
    mockGetUser.mockResolvedValue({ customClaims: { role: 'admin', extraRoles: ['kiosk'] } });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'admin@example.com',
      contactProvenance: 'password',
    });

    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    expect(res.claims.role).toBe('admin');
    expect(res.redirectTo).toBe('/admin');
  });

  it('still redirects a brand-new no-role account to register (guard intact)', async () => {
    mockGetUser.mockResolvedValue({ customClaims: {} });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'stranger@example.com',
      contactProvenance: 'password',
    });

    expect(hasSession(res)).toBe(false);
    expect('redirectTo' in res && res.redirectTo).toBe('/register?contact=verified');
  });
});
