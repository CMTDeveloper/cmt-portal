import { describe, it, expect, vi, beforeEach } from 'vitest';

// The coordinator role must be able to hold a session with NO family. Three
// separate sites decide that, and preservedExtras() is only one of them: the
// /register bounce guard and the family-less claim-minting chain both listed
// admin/welcome-team/kiosk only, so a coordinator-only account was sent to
// /register with no session at all and no later gate could ever be reached.
//
// Coordinator differs from kiosk in one way that matters here: it is GRANTABLE,
// so it can arrive either on the account's custom claims OR mid-keyed via
// roleAssignments (getMemberRoles). Both paths are covered below.

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

describe('build-session-claims - coordinator role', () => {
  it('mints a primary coordinator session for a sevak with no family', async () => {
    mockGetUser.mockResolvedValue({ customClaims: { role: 'coordinator' } });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'coordinator@chinmayatoronto.org',
      contactProvenance: 'password',
    });

    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    expect(res.claims.role).toBe('coordinator');
    expect(res.claims.fid).toBeUndefined();
    expect(res.redirectTo).toBe('/welcome/roster');
  });

  it('does NOT bounce a family-less coordinator to /register', async () => {
    mockGetUser.mockResolvedValue({ customClaims: { role: 'coordinator' } });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'coordinator@chinmayatoronto.org',
      contactProvenance: 'password',
    });

    expect(res).not.toEqual({ redirectTo: '/register?contact=verified' });
  });

  it('mints a coordinator session when coordinator is carried ONLY in extraRoles', async () => {
    mockGetUser.mockResolvedValue({ customClaims: { extraRoles: ['coordinator'] } });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'coordinator@chinmayatoronto.org',
      contactProvenance: 'password',
    });

    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    expect(res.claims.role).toBe('coordinator');
    expect(res.redirectTo).toBe('/welcome/roster');
  });

  it('preserves coordinator in extraRoles for a coordinator who is also a parent', async () => {
    // The mid-keyed path: the grant lives in roleAssignments, not on the account
    // claims, and the family role must still win the primary slot.
    mockGetMemberRoles.mockResolvedValue(['coordinator']);
    mockFind.mockResolvedValue({
      source: 'setu',
      fid: 'CMT-FAM-01',
      mid: 'CMT-FAM-01-01',
      member: { manager: true, firstName: 'Coord', lastName: 'Parent' },
      family: { fid: 'CMT-FAM-01', name: 'Parent' },
    });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'coordinator.parent@example.com',
      contactProvenance: 'password',
    });

    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    expect(res.claims.role).toBe('family-manager');
    expect(res.claims.extraRoles).toContain('coordinator');
  });

  it('admin wins over coordinator (admin inherits it) and does not duplicate the extra', async () => {
    mockGetUser.mockResolvedValue({ customClaims: { role: 'admin', extraRoles: ['coordinator'] } });

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

  it('welcome-team still wins over coordinator when both are held (they are siblings)', async () => {
    // Order in the family-less chain is deliberate and pinned: welcome-team is
    // the broader existing staff surface, so it keeps the primary slot.
    mockGetUser.mockResolvedValue({ customClaims: { role: 'welcome-team', extraRoles: ['coordinator'] } });

    const res = await buildSessionClaimsForContact({
      type: 'email',
      value: 'both@chinmayatoronto.org',
      contactProvenance: 'password',
    });

    expect(hasSession(res)).toBe(true);
    if (!hasSession(res)) return;
    expect(res.claims.role).toBe('welcome-team');
    // '/welcome/roster', not '/welcome': the index is a next.config redirect
    // now, so naming it here would cost a signed-in sevak an extra round trip.
    expect(res.redirectTo).toBe('/welcome/roster');
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
