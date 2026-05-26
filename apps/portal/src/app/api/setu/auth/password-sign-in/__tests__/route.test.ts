import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

vi.mock('@/features/check-in/shared', () => ({
  checkAndRecordOtpRateLimit: vi.fn(),
  normalizeContact: vi.fn((_type: string, value: string) => value.toLowerCase()),
}));

vi.mock('@/features/setu/auth/firebase-rest', () => ({
  firebaseSignInWithPassword: vi.fn(),
}));

vi.mock('@/features/setu/auth/build-session-claims', () => ({
  buildSessionClaimsForContact: vi.fn(),
  hasSession: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(() => ({
    setCustomUserClaims: vi.fn(),
    createCustomToken: vi.fn().mockResolvedValue('custom-token-abc'),
  })),
}));

vi.mock('@cmt/firebase-shared/admin/session', () => ({
  exchangeCustomTokenForIdToken: vi.fn().mockResolvedValue('id-token-abc'),
  createPortalSessionCookie: vi.fn().mockResolvedValue('session-cookie-abc'),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return actual;
});

import { POST } from '../route';
import { checkAndRecordOtpRateLimit } from '@/features/check-in/shared';
import { firebaseSignInWithPassword } from '@/features/setu/auth/firebase-rest';
import { buildSessionClaimsForContact, hasSession } from '@/features/setu/auth/build-session-claims';

function makeRequest(body: unknown, url = 'http://localhost/api/setu/auth/password-sign-in') {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const mockedRateLimit = vi.mocked(checkAndRecordOtpRateLimit);
const mockedSignIn = vi.mocked(firebaseSignInWithPassword);
const mockedBuildClaims = vi.mocked(buildSessionClaimsForContact);
const mockedHasSession = vi.mocked(hasSession);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRateLimit.mockResolvedValue({ allowed: true });
});

describe('POST /api/setu/auth/password-sign-in', () => {
  it('400 on missing email', async () => {
    const res = await POST(makeRequest({ password: 'secret' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad-request' });
  });

  it('400 on invalid email format', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email', password: 'secret' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad-request' });
  });

  it('400 on missing password', async () => {
    const res = await POST(makeRequest({ email: 'raj@example.com' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad-request' });
  });

  it('400 on empty password', async () => {
    const res = await POST(makeRequest({ email: 'raj@example.com', password: '' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad-request' });
  });

  it('429 on rate limit hit', async () => {
    mockedRateLimit.mockResolvedValue({ allowed: false, resetAt: '2026-05-25T00:00:00Z' });
    const res = await POST(makeRequest({ email: 'raj@example.com', password: 'secret' }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'too-many-requests', resetAt: '2026-05-25T00:00:00Z' });
  });

  it('401 on invalid-credentials', async () => {
    mockedSignIn.mockResolvedValue({ ok: false, error: 'invalid-credentials' });
    const res = await POST(makeRequest({ email: 'raj@example.com', password: 'wrong' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid-credentials' });
  });

  it('403 on user-disabled', async () => {
    mockedSignIn.mockResolvedValue({ ok: false, error: 'user-disabled' });
    const res = await POST(makeRequest({ email: 'blocked@example.com', password: 'secret' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'user-disabled' });
  });

  it('429 on too-many-requests from Firebase', async () => {
    mockedSignIn.mockResolvedValue({ ok: false, error: 'too-many-requests' });
    const res = await POST(makeRequest({ email: 'raj@example.com', password: 'secret' }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'too-many-requests' });
  });

  it('500 on network error', async () => {
    mockedSignIn.mockResolvedValue({ ok: false, error: 'network' });
    const res = await POST(makeRequest({ email: 'raj@example.com', password: 'secret' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'network' });
  });

  it('happy path with family: 200 + session cookie + redirectTo /family', async () => {
    mockedSignIn.mockResolvedValue({
      ok: true,
      uid: 'uid-abc',
      email: 'raj@example.com',
      idToken: 'id-tok',
      refreshToken: 'ref-tok',
    });
    const sessionResult = { uid: 'uid-abc', claims: { role: 'family-manager', fid: 'CMT-001' }, redirectTo: '/family' };
    mockedBuildClaims.mockResolvedValue(sessionResult);
    mockedHasSession.mockReturnValue(true);

    const res = await POST(makeRequest({ email: 'raj@example.com', password: 'secret' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ redirectTo: '/family' });
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain('__session=session-cookie-abc');
  });

  it('happy path mode:mobile returns customToken, no cookie', async () => {
    mockedSignIn.mockResolvedValue({
      ok: true,
      uid: 'uid-abc',
      email: 'raj@example.com',
      idToken: 'id-tok',
      refreshToken: 'ref-tok',
    });
    const sessionResult = { uid: 'uid-abc', claims: { role: 'family-manager', fid: 'CMT-001' }, redirectTo: '/family' };
    mockedBuildClaims.mockResolvedValue(sessionResult);
    mockedHasSession.mockReturnValue(true);

    const res = await POST(makeRequest({ email: 'raj@example.com', password: 'secret', mode: 'mobile' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ customToken: 'custom-token-abc' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('no-session result (new user): 200 with redirectTo /register', async () => {
    mockedSignIn.mockResolvedValue({
      ok: true,
      uid: 'uid-new',
      email: 'newuser@example.com',
      idToken: 'id-tok',
      refreshToken: 'ref-tok',
    });
    mockedBuildClaims.mockResolvedValue({ redirectTo: '/register?contact=verified' });
    mockedHasSession.mockReturnValue(false);

    const res = await POST(makeRequest({ email: 'newuser@example.com', password: 'secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectTo: '/register?contact=verified' });
  });

  it('passes contactProvenance:password to buildSessionClaimsForContact', async () => {
    mockedSignIn.mockResolvedValue({
      ok: true,
      uid: 'uid-abc',
      email: 'raj@example.com',
      idToken: 'id-tok',
      refreshToken: 'ref-tok',
    });
    mockedBuildClaims.mockResolvedValue({ redirectTo: '/register?contact=verified' });
    mockedHasSession.mockReturnValue(false);

    await POST(makeRequest({ email: 'raj@example.com', password: 'secret' }));
    expect(mockedBuildClaims).toHaveBeenCalledWith(
      expect.objectContaining({ contactProvenance: 'password' }),
    );
  });

  it('honors ?from= safe redirect param', async () => {
    mockedSignIn.mockResolvedValue({
      ok: true,
      uid: 'uid-abc',
      email: 'raj@example.com',
      idToken: 'id-tok',
      refreshToken: 'ref-tok',
    });
    const sessionResult = { uid: 'uid-abc', claims: { role: 'family-manager' }, redirectTo: '/family' };
    mockedBuildClaims.mockResolvedValue(sessionResult);
    mockedHasSession.mockReturnValue(true);

    const res = await POST(makeRequest(
      { email: 'raj@example.com', password: 'secret' },
      'http://localhost/api/setu/auth/password-sign-in?from=/family/members',
    ));
    const body = await res.json();
    expect(body.redirectTo).toBe('/family/members');
  });

  it('rejects unsafe ?from= redirect (//evil.com)', async () => {
    mockedSignIn.mockResolvedValue({
      ok: true,
      uid: 'uid-abc',
      email: 'raj@example.com',
      idToken: 'id-tok',
      refreshToken: 'ref-tok',
    });
    const sessionResult = { uid: 'uid-abc', claims: { role: 'family-manager' }, redirectTo: '/family' };
    mockedBuildClaims.mockResolvedValue(sessionResult);
    mockedHasSession.mockReturnValue(true);

    const res = await POST(makeRequest(
      { email: 'raj@example.com', password: 'secret' },
      'http://localhost/api/setu/auth/password-sign-in?from=//evil.com',
    ));
    const body = await res.json();
    expect(body.redirectTo).toBe('/family');
  });
});
