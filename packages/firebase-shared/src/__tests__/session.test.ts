import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn((_c, name) => ({ name })),
  cert: vi.fn((c) => c),
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

const mockAuth = {
  createSessionCookie: vi.fn(),
  verifySessionCookie: vi.fn(),
  verifyIdToken: vi.fn(),
};
vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => mockAuth),
}));

import {
  createPortalSessionCookie,
  verifyPortalSessionCookie,
  verifyPortalIdToken,
  exchangeCustomTokenForIdToken,
} from '../admin/session';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.createSessionCookie.mockReset();
  mockAuth.verifySessionCookie.mockReset();
  mockAuth.verifyIdToken.mockReset();
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
  process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
  process.env.PORTAL_FIREBASE_PRIVATE_KEY = 'key';
  process.env.NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY = 'AIza-fake';
});

describe('createPortalSessionCookie', () => {
  it('creates a session cookie with the configured expiry', async () => {
    mockAuth.createSessionCookie.mockResolvedValueOnce('session-token');
    const result = await createPortalSessionCookie('id-token', 5);
    expect(mockAuth.createSessionCookie).toHaveBeenCalledWith('id-token', {
      expiresIn: 5 * 24 * 60 * 60 * 1000,
    });
    expect(result).toBe('session-token');
  });
});

describe('verifyPortalSessionCookie', () => {
  it('verifies with checkRevoked=true by default', async () => {
    mockAuth.verifySessionCookie.mockResolvedValueOnce({ uid: 'u1', role: 'admin' });
    const claims = await verifyPortalSessionCookie('session-token');
    expect(mockAuth.verifySessionCookie).toHaveBeenCalledWith('session-token', true);
    expect(claims!.uid).toBe('u1');
    expect(claims!.role).toBe('admin');
  });

  it('returns null when verification throws', async () => {
    mockAuth.verifySessionCookie.mockRejectedValueOnce(new Error('expired'));
    const claims = await verifyPortalSessionCookie('bad-token');
    expect(claims).toBeNull();
  });
});

describe('verifyPortalIdToken', () => {
  it('verifies a bearer ID token with checkRevoked', async () => {
    mockAuth.verifyIdToken.mockResolvedValueOnce({ uid: 'u2', role: 'teacher' });
    const claims = await verifyPortalIdToken('id-token');
    expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('id-token', true);
    expect(claims?.uid).toBe('u2');
  });

  it('returns null when verification throws', async () => {
    mockAuth.verifyIdToken.mockRejectedValueOnce(new Error('invalid'));
    const claims = await verifyPortalIdToken('bad');
    expect(claims).toBeNull();
  });
});

describe('exchangeCustomTokenForIdToken', () => {
  it('calls the Identity Toolkit REST endpoint and returns the idToken', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ idToken: 'the-id-token', refreshToken: 'r', expiresIn: '3600' }),
    } as Response);

    const idToken = await exchangeCustomTokenForIdToken('custom-tok');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIza-fake',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'custom-tok', returnSecureToken: true }),
      }),
    );
    expect(idToken).toBe('the-id-token');
  });

  it('throws a clear error on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'INVALID_CUSTOM_TOKEN' } }),
    } as Response);
    await expect(exchangeCustomTokenForIdToken('bad')).rejects.toThrow(/INVALID_CUSTOM_TOKEN/);
  });
});
