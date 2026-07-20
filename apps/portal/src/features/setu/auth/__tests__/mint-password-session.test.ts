import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/check-in/shared', () => ({
  checkAndRecordOtpRateLimit: vi.fn(),
  normalizeContact: vi.fn((_type: string, value: string) => value.toLowerCase()),
}));

vi.mock('@/features/setu/auth/firebase-rest', () => ({
  firebaseSignInWithPassword: vi.fn(),
}));

vi.mock('@/features/setu/auth/build-session-claims', () => ({
  buildSessionClaimsForContact: vi.fn(),
  hasSession: (r: unknown) => typeof r === 'object' && r !== null && 'uid' in r,
  isPendingApproval: (r: unknown) =>
    typeof r === 'object' && r !== null && 'pendingApproval' in r,
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

import { mintPasswordSession } from '../mint-password-session';
import { checkAndRecordOtpRateLimit } from '@/features/check-in/shared';
import { firebaseSignInWithPassword } from '@/features/setu/auth/firebase-rest';
import { buildSessionClaimsForContact } from '@/features/setu/auth/build-session-claims';

const mockedRateLimit = vi.mocked(checkAndRecordOtpRateLimit);
const mockedSignIn = vi.mocked(firebaseSignInWithPassword);
const mockedBuildClaims = vi.mocked(buildSessionClaimsForContact);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRateLimit.mockResolvedValue({ allowed: true });
});

describe('mintPasswordSession', () => {
  it('web happy path returns a session with cookie + maxAge', async () => {
    mockedSignIn.mockResolvedValue({
      ok: true,
      uid: 'uid-abc',
      email: 'kiosk@example.com',
      idToken: 'id-tok',
      refreshToken: 'ref-tok',
    });
    mockedBuildClaims.mockResolvedValue({
      uid: 'uid-abc',
      claims: { role: 'kiosk', email: 'kiosk@example.com' },
      redirectTo: '/check-in',
    });

    const result = await mintPasswordSession({ email: 'kiosk@example.com', password: 'secret' });
    expect(result).toEqual({
      status: 'session',
      redirectTo: '/check-in',
      cookieValue: 'session-cookie-abc',
      maxAgeSeconds: 14 * 24 * 60 * 60,
      uid: 'uid-abc',
      claims: { role: 'kiosk', email: 'kiosk@example.com' },
    });
  });

  it('a safe ?from overrides the base redirectTo', async () => {
    mockedSignIn.mockResolvedValue({
      ok: true,
      uid: 'uid-abc',
      email: 'kiosk@example.com',
      idToken: 'id-tok',
      refreshToken: 'ref-tok',
    });
    mockedBuildClaims.mockResolvedValue({
      uid: 'uid-abc',
      claims: { role: 'kiosk' },
      redirectTo: '/check-in',
    });

    const result = await mintPasswordSession({
      email: 'kiosk@example.com',
      password: 'secret',
      from: '/check-in/guest',
    });
    expect(result.status).toBe('session');
    if (result.status === 'session') expect(result.redirectTo).toBe('/check-in/guest');
  });

  it('an unsafe ?from is ignored, base redirectTo wins', async () => {
    mockedSignIn.mockResolvedValue({
      ok: true,
      uid: 'uid-abc',
      email: 'kiosk@example.com',
      idToken: 'id-tok',
      refreshToken: 'ref-tok',
    });
    mockedBuildClaims.mockResolvedValue({
      uid: 'uid-abc',
      claims: { role: 'kiosk' },
      redirectTo: '/check-in',
    });

    const result = await mintPasswordSession({
      email: 'kiosk@example.com',
      password: 'secret',
      from: '//evil.com',
    });
    if (result.status === 'session') expect(result.redirectTo).toBe('/check-in');
  });

  it('mobile mode returns a customToken and no cookie', async () => {
    mockedSignIn.mockResolvedValue({
      ok: true,
      uid: 'uid-abc',
      email: 'raj@example.com',
      idToken: 'id-tok',
      refreshToken: 'ref-tok',
    });
    mockedBuildClaims.mockResolvedValue({
      uid: 'uid-abc',
      claims: { role: 'family-manager' },
      redirectTo: '/family',
    });

    const result = await mintPasswordSession({
      email: 'raj@example.com',
      password: 'secret',
      mode: 'mobile',
    });
    expect(result).toEqual({ status: 'mobile', customToken: 'custom-token-abc' });
  });

  it('rate-limit hit returns a 429 error result with resetAt', async () => {
    mockedRateLimit.mockResolvedValue({ allowed: false, resetAt: '2026-05-25T00:00:00Z' });

    const result = await mintPasswordSession({ email: 'raj@example.com', password: 'secret' });
    expect(result).toEqual({
      status: 'error',
      httpStatus: 429,
      error: 'too-many-requests',
      resetAt: '2026-05-25T00:00:00Z',
    });
  });

  it('invalid-credentials returns a 401 error result', async () => {
    mockedSignIn.mockResolvedValue({ ok: false, error: 'invalid-credentials' });

    const result = await mintPasswordSession({ email: 'raj@example.com', password: 'wrong' });
    expect(result).toEqual({ status: 'error', httpStatus: 401, error: 'invalid-credentials' });
  });

  it('pending-approval is surfaced as its own result', async () => {
    mockedSignIn.mockResolvedValue({
      ok: true,
      uid: 'uid-gated',
      email: 'asha@example.com',
      idToken: 'id-tok',
      refreshToken: 'ref-tok',
    });
    mockedBuildClaims.mockResolvedValue({
      pendingApproval: true,
      pendingFid: 'CMT-001',
      pendingMatchedMid: 'CMT-001-02',
    });

    const result = await mintPasswordSession({ email: 'asha@example.com', password: 'secret' });
    expect(result).toEqual({
      status: 'pending-approval',
      pendingFid: 'CMT-001',
      pendingMatchedMid: 'CMT-001-02',
    });
  });
});
