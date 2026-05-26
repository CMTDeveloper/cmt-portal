import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { firebaseSignInWithPassword } from '../firebase-rest';

const originalEnv = process.env;

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv, NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY: 'test-api-key' };
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response);
}

function mockFetchNetworkError() {
  vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network failure'));
}

describe('firebaseSignInWithPassword', () => {
  it('happy path: returns ok=true with uid (localId), email, idToken, refreshToken', async () => {
    mockFetch(200, {
      localId: 'uid-abc123',
      email: 'raj@example.com',
      idToken: 'id-token-xyz',
      refreshToken: 'refresh-token-xyz',
    });
    const result = await firebaseSignInWithPassword({ email: 'raj@example.com', password: 'secret1' });
    expect(result).toEqual({
      ok: true,
      uid: 'uid-abc123',
      email: 'raj@example.com',
      idToken: 'id-token-xyz',
      refreshToken: 'refresh-token-xyz',
    });
  });

  it('INVALID_LOGIN_CREDENTIALS → invalid-credentials', async () => {
    mockFetch(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
    const result = await firebaseSignInWithPassword({ email: 'x@x.com', password: 'wrong' });
    expect(result).toEqual({ ok: false, error: 'invalid-credentials' });
  });

  it('INVALID_PASSWORD → invalid-credentials', async () => {
    mockFetch(400, { error: { message: 'INVALID_PASSWORD' } });
    const result = await firebaseSignInWithPassword({ email: 'x@x.com', password: 'wrong' });
    expect(result).toEqual({ ok: false, error: 'invalid-credentials' });
  });

  it('EMAIL_NOT_FOUND → invalid-credentials (no enumeration)', async () => {
    mockFetch(400, { error: { message: 'EMAIL_NOT_FOUND' } });
    const result = await firebaseSignInWithPassword({ email: 'ghost@x.com', password: 'pw' });
    expect(result).toEqual({ ok: false, error: 'invalid-credentials' });
  });

  it('USER_DISABLED → user-disabled', async () => {
    mockFetch(400, { error: { message: 'USER_DISABLED' } });
    const result = await firebaseSignInWithPassword({ email: 'blocked@x.com', password: 'pw' });
    expect(result).toEqual({ ok: false, error: 'user-disabled' });
  });

  it('TOO_MANY_ATTEMPTS_TRY_LATER → too-many-requests', async () => {
    mockFetch(400, { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER : Access blocked' } });
    const result = await firebaseSignInWithPassword({ email: 'x@x.com', password: 'pw' });
    expect(result).toEqual({ ok: false, error: 'too-many-requests' });
  });

  it('network error (fetch throws) → network', async () => {
    mockFetchNetworkError();
    const result = await firebaseSignInWithPassword({ email: 'x@x.com', password: 'pw' });
    expect(result).toEqual({ ok: false, error: 'network' });
  });

  it('verifies the REST endpoint URL and request body', async () => {
    mockFetch(200, {
      localId: 'uid',
      email: 'raj@example.com',
      idToken: 'tok',
      refreshToken: 'ref',
    });
    await firebaseSignInWithPassword({ email: 'raj@example.com', password: 'pass123' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test-api-key',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'raj@example.com', password: 'pass123', returnSecureToken: true }),
      }),
    );
  });
});
