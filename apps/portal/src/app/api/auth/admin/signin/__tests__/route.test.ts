import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@cmt/firebase-shared/admin/session', () => ({
  signInWithEmailPassword: vi.fn(),
  createPortalSessionCookie: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/claims', () => ({
  getPortalUserWithClaims: vi.fn(),
}));

import {
  signInWithEmailPassword,
  createPortalSessionCookie,
} from '@cmt/firebase-shared/admin/session';
import { getPortalUserWithClaims } from '@cmt/firebase-shared/admin/claims';

import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_COOKIE_EXPIRES_DAYS = '5';
});

describe('POST /api/auth/admin/signin', () => {
  it('returns 400 on missing body fields', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 401 on wrong password', async () => {
    (signInWithEmailPassword as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('INVALID_LOGIN_CREDENTIALS'),
    );
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
        });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'unauthorized' });
      },
    });
  });

  it('returns 403 when user has no admin claim', async () => {
    (signInWithEmailPassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      idToken: 'id-tok',
      localId: 'u1',
    });
    (getPortalUserWithClaims as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u1',
      email: 'a@b.com',
      claims: { role: 'family' },
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com', password: 'right' }),
        });
        expect(res.status).toBe(403);
      },
    });
  });

  it('returns 200 and sets __session cookie on success', async () => {
    (signInWithEmailPassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      idToken: 'id-tok',
      localId: 'u1',
    });
    (getPortalUserWithClaims as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u1',
      email: 'a@b.com',
      claims: { role: 'admin' },
    });
    (createPortalSessionCookie as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'sess-tok',
    );
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com', password: 'right' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.redirectTo).toBe('/check-in/admin');
        const setCookie = res.headers.get('set-cookie');
        expect(setCookie).toMatch(/__session=sess-tok/);
        expect(setCookie).toMatch(/HttpOnly/);
        expect(setCookie).toMatch(/SameSite=lax/i);
      },
    });
  });
});
