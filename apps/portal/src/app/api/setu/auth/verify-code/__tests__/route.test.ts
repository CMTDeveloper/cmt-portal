import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/check-in/shared', () => ({
  normalizeContact: vi.fn((type: string, value: string) =>
    type === 'email' ? value.toLowerCase().trim() : value.replace(/\D/g, ''),
  ),
  sha256Hex: vi.fn((s: string) => `hash:${s}`),
  verifyCode: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  createPortalSessionCookie: vi.fn(),
  exchangeCustomTokenForIdToken: vi.fn(),
}));
vi.mock('@/features/setu/auth/find-family-by-contact', () => ({
  findSetuFamilyByContact: vi.fn(),
}));
vi.mock('@/features/setu/registration/lazy-migrate', () => ({
  lazyMigrateLegacyFamily: vi.fn(),
}));
vi.mock('@/features/setu/auth/member-roles', () => ({
  getMemberRoles: vi.fn(async () => []),
}));
vi.mock('@/features/setu/teacher/assignments', () => ({
  isTeacherAssigned: vi.fn(async () => false),
}));
vi.mock('@/features/setu/registration/registration-grant', () => ({
  issueRegistrationGrant: vi.fn(async () => 'grant-tok-xyz'),
}));
const mockRequestFamilyAccess = vi.hoisted(() =>
  vi.fn(async () => ({ outcome: 'created' as const, notified: 1 })),
);
vi.mock('@/features/setu/join-request/request-family-access', () => ({
  requestFamilyAccess: mockRequestFamilyAccess,
}));
vi.mock('@/lib/env', () => ({ portalEnv: () => ({ SETU_INVITE_TTL_DAYS: 14 }) }));
vi.mock('@/lib/portal-base-url', () => ({
  portalBaseUrl: () => 'https://setu.chinmayatoronto.org',
}));

import { POST } from '../route';
import { verifyCode } from '@/features/check-in/shared';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';
import { lazyMigrateLegacyFamily } from '@/features/setu/registration/lazy-migrate';

const mockGetUser = vi.fn();
const mockCreateUser = vi.fn();
const mockSetCustomUserClaims = vi.fn();
const mockCreateCustomToken = vi.fn();

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/setu/auth/verify-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (portalAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    getUser: mockGetUser,
    createUser: mockCreateUser,
    setCustomUserClaims: mockSetCustomUserClaims,
    createCustomToken: mockCreateCustomToken,
  });
  mockGetUser.mockResolvedValue({ uid: 'hash:raj@example.com' });
  mockSetCustomUserClaims.mockResolvedValue(undefined);
  mockCreateCustomToken.mockResolvedValue('custom-token');
  (exchangeCustomTokenForIdToken as ReturnType<typeof vi.fn>).mockResolvedValue('id-token');
  (createPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValue('session-cookie');
});

describe('POST /api/setu/auth/verify-code', () => {
  it('returns 400 on bad payload', async () => {
    const res = await POST(makeRequest({ foo: 'bar' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on wrong code', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await POST(makeRequest({ type: 'email', value: 'raj@example.com', code: '000000' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid-or-expired');
  });

  it('correct code with Setu hit (manager) sets cookie and redirects to /family', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-01', legacyFid: null, family: {},
      member: { manager: true },
    });
    const res = await POST(makeRequest({ type: 'email', value: 'raj@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe('/family');
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'hash:raj@example.com',
      expect.objectContaining({ role: 'family-manager', fid: 'FAM001', mid: 'FAM001-01' }),
    );
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('__session');
  });

  it('correct code with Setu hit (non-manager) assigns family-member role', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-02', legacyFid: null, family: {},
      member: { manager: false },
    });
    const res = await POST(makeRequest({ type: 'email', value: 'aarti@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family-member', fid: 'FAM001', mid: 'FAM001-02' }),
    );
  });

  it('legacy hit: migration fails → falls back to legacy claims and /register', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'legacy', fid: null, mid: null, legacyFid: '42', family: {},
    });
    (lazyMigrateLegacyFamily as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('RTDB error'));
    const res = await POST(makeRequest({ type: 'email', value: 'sharma@example.com', code: '654321' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe('/register?contact=verified');
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family', familyId: '42' }),
    );
  });

  it('legacy hit: migration succeeds → re-lookup returns Setu hit → redirects to /family', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    // First call: legacy hit
    // Second call (post-migration): setu hit
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ source: 'legacy', fid: null, mid: null, legacyFid: '42', family: {} })
      .mockResolvedValueOnce({ source: 'setu', fid: 'FAMNEW', mid: 'FAMNEW-01', legacyFid: '42', family: {}, member: { manager: true } });
    (lazyMigrateLegacyFamily as ReturnType<typeof vi.fn>).mockResolvedValue({ migrated: true, fid: 'FAMNEW', legacyFid: '42' });
    const res = await POST(makeRequest({ type: 'email', value: 'sharma@example.com', code: '654321' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe('/family');
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family-manager', fid: 'FAMNEW', mid: 'FAMNEW-01' }),
    );
  });

  it('legacy hit: migration succeeds but re-lookup misses → falls back to legacy claims', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ source: 'legacy', fid: null, mid: null, legacyFid: '42', family: {} })
      .mockResolvedValueOnce({ source: null, fid: null, mid: null, legacyFid: null, family: null });
    (lazyMigrateLegacyFamily as ReturnType<typeof vi.fn>).mockResolvedValue({ migrated: true, fid: 'FAMNEW', legacyFid: '42' });
    const res = await POST(makeRequest({ type: 'email', value: 'sharma@example.com', code: '654321' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe('/register?contact=verified');
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family', familyId: '42' }),
    );
  });

  it('gated member (portalAccess pending) returns pendingApproval and mints NO family session', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-03', legacyFid: null, family: {},
      member: { manager: false, portalAccess: 'pending' },
    });
    const res = await POST(makeRequest({ type: 'email', value: 'pending@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ pendingApproval: true, pendingFid: 'FAM001', pendingMatchedMid: 'FAM001-03' });
    // No family claims, no session cookie.
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(body.redirectTo).toBeUndefined();
  });

  // ── The pending screen says "We've let them know" ─────────────────────────
  //
  // 🔴 Vaibhav, from production 2026-07-31: his wife signed in, was told her
  // access was pending and that her manager had been notified, and he received
  // nothing. This branch returned the pending signal and sent NOTHING; the only
  // notifying code sat behind a button on the next screen labelled "Re-send".
  //
  // Asserted at the ROUTE, not only in the helper's own tests, because the
  // defect was never inside the notifier - it was that this caller did not
  // reach for it. A helper test would have passed throughout the outage.
  it('NOTIFIES the family managers when it gates a member', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-03', legacyFid: null, family: {},
      member: { manager: false, portalAccess: 'pending' },
    });
    await POST(makeRequest({ type: 'email', value: 'Pending@Example.com', code: '123456' }));
    expect(mockRequestFamilyAccess).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'email', value: 'Pending@Example.com' }),
    );
    // An ABSOLUTE review link. A host-less "/join-request/<token>" in a real
    // email is the failure this project has already shipped once.
    expect(mockRequestFamilyAccess).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://setu.chinmayatoronto.org' }),
    );
    // notifyOnExisting stays off here: a member signing in again next week must
    // not re-ping their manager. Only the explicit re-send button turns it on.
    expect(mockRequestFamilyAccess).not.toHaveBeenCalledWith(
      expect.objectContaining({ notifyOnExisting: true }),
    );
  });

  it('still gates the member when the notification throws', async () => {
    // A flaky SES must not fail a sign-in that already succeeded, and must not
    // turn a correct "pending" answer into an error the family cannot act on.
    mockRequestFamilyAccess.mockRejectedValueOnce(new Error('SES is down'));
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-03', legacyFid: null, family: {},
      member: { manager: false, portalAccess: 'pending' },
    });
    const res = await POST(makeRequest({ type: 'email', value: 'pending@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      pendingApproval: true, pendingFid: 'FAM001', pendingMatchedMid: 'FAM001-03',
    });
  });

  it('does NOT raise a join request for a member who is let straight in', async () => {
    // Only a GATED member is awaiting approval. Asking for access on behalf of
    // someone who just received a session would email their manager about a
    // request that does not exist.
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-01', legacyFid: null, family: {},
      member: { manager: true, portalAccess: 'active' },
    });
    await POST(makeRequest({ type: 'email', value: 'raj@example.com', code: '123456' }));
    expect(mockRequestFamilyAccess).not.toHaveBeenCalled();
  });

  it('manager is NOT gated even if portalAccess is pending → normal family-manager claims', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-01', legacyFid: null, family: {},
      member: { manager: true, portalAccess: 'pending' },
    });
    const res = await POST(makeRequest({ type: 'email', value: 'raj@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe('/family');
    expect(body.pendingApproval).toBeUndefined();
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family-manager', fid: 'FAM001', mid: 'FAM001-01' }),
    );
  });

  it('active member (portalAccess active) is NOT gated → normal family-member claims', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-02', legacyFid: null, family: {},
      member: { manager: false, portalAccess: 'active' },
    });
    const res = await POST(makeRequest({ type: 'email', value: 'aarti@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe('/family');
    expect(body.pendingApproval).toBeUndefined();
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family-member', fid: 'FAM001', mid: 'FAM001-02' }),
    );
  });

  it('member WITHOUT portalAccess (absent ⇒ active) is NOT gated → normal family-member claims', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-02', legacyFid: null, family: {},
      member: { manager: false },
    });
    const res = await POST(makeRequest({ type: 'email', value: 'aarti@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe('/family');
    expect(body.pendingApproval).toBeUndefined();
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family-member' }),
    );
  });

  it('lazy-migrated non-primary adult resolves to pending → pendingApproval, no session', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    // First lookup: legacy hit. Post-migration re-lookup: gated pending member.
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ source: 'legacy', fid: null, mid: null, legacyFid: '42', family: {} })
      .mockResolvedValueOnce({
        source: 'setu', fid: 'FAMNEW', mid: 'FAMNEW-03', legacyFid: '42', family: {},
        member: { manager: false, portalAccess: 'pending' },
      });
    (lazyMigrateLegacyFamily as ReturnType<typeof vi.fn>).mockResolvedValue({ migrated: true, fid: 'FAMNEW', legacyFid: '42' });
    const res = await POST(makeRequest({ type: 'email', value: 'second.adult@example.com', code: '654321' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ pendingApproval: true, pendingFid: 'FAMNEW', pendingMatchedMid: 'FAMNEW-03' });
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('correct code with no family redirects to /register AND issues a registration grant (email)', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: null, fid: null, mid: null, legacyFid: null, family: null,
    });
    const res = await POST(makeRequest({ type: 'email', value: 'new@example.com', code: '111111' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe('/register?contact=verified');
    // The grant proves the email was OTP-verified; register requires it.
    expect(body.registrationGrant).toBe('grant-tok-xyz');
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    // No session minted for a contact with no family.
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('does NOT issue a registration grant for a phone with no family (phone reg unsupported v1)', async () => {
    // The guarantee is unchanged and now enforced earlier: with SMS sign-in off
    // the phone is refused up front, so no grant can be issued. It used to be a
    // 200 with the grant merely absent.
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: null, fid: null, mid: null, legacyFid: null, family: null,
    });
    const res = await POST(makeRequest({ type: 'phone', value: '4165550000', code: '111111' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('sms-signin-unsupported');
    expect(body.registrationGrant).toBeUndefined();
  });

  it('refuses a phone before consuming a verification attempt', async () => {
    // Mirrors send-code so nobody burns attempts against a code that was never
    // sent, and so the message names the channel rather than blaming the family
    // for an "invalid or expired" code.
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const res = await POST(makeRequest({ type: 'phone', value: '4165550000', code: '111111' }));
    expect(res.status).toBe(400);
    expect(verifyCode).not.toHaveBeenCalled();
  });

  it('creates user if not found in Firebase Auth', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-01', legacyFid: null, family: {},
    });
    mockGetUser.mockRejectedValue({ code: 'auth/user-not-found' });
    mockCreateUser.mockResolvedValue({ uid: 'hash:raj@example.com' });
    const res = await POST(makeRequest({ type: 'email', value: 'raj@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    expect(mockCreateUser).toHaveBeenCalledWith({ uid: 'hash:raj@example.com', disabled: false });
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest({ type: 'email', value: 'raj@example.com', code: '123456' }));
    expect(res.status).toBe(404);
  });
});
