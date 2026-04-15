import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/shared', () => ({
  verifyCode: vi.fn(),
  findFamilyByContact: vi.fn(),
  normalizeContact: (t: string, v: string) =>
    t === 'email' ? v.toLowerCase() : v.replace(/\D/g, ''),
  sha256Hex: (s: string) => `hash-${s}`,
}));

vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(() => ({
    getUser: vi.fn(),
    createUser: vi.fn(),
  })),
}));

vi.mock('@cmt/firebase-shared/admin/claims', () => ({
  setPortalUserClaims: vi.fn(),
  createPortalCustomToken: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/session', () => ({
  exchangeCustomTokenForIdToken: vi.fn(),
  createPortalSessionCookie: vi.fn(),
}));

import { verifyCode, findFamilyByContact } from '@/features/check-in/shared';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  setPortalUserClaims,
  createPortalCustomToken,
} from '@cmt/firebase-shared/admin/claims';
import {
  exchangeCustomTokenForIdToken,
  createPortalSessionCookie,
} from '@cmt/firebase-shared/admin/session';

import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_COOKIE_EXPIRES_DAYS = '5';
});

function happyPathMocks() {
  (verifyCode as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
  (findFamilyByContact as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    fid: '42',
    name: 'Acme',
  });
  const authMock = {
    getUser: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
    createUser: vi.fn().mockResolvedValue({ uid: 'hash-a@b.com' }),
  };
  (portalAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(authMock);
  (createPortalCustomToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('ctok');
  (exchangeCustomTokenForIdToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    'idtok',
  );
  (createPortalSessionCookie as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('sess');
}

describe('POST /api/auth/family/verify-code', () => {
  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 401 with invalid-or-expired on wrong code', async () => {
    (verifyCode as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com', code: '000000' }),
        });
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe('invalid-or-expired');
      },
    });
  });

  it('returns 401 with invalid-or-expired when family not found after valid code', async () => {
    (verifyCode as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (findFamilyByContact as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'nobody@example.com', code: '123456' }),
        });
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe('invalid-or-expired');
      },
    });
  });

  it('returns 200 + session cookie on happy path (web mode default)', async () => {
    happyPathMocks();
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com', code: '123456' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.redirectTo).toBe('/check-in/family');
        expect(res.headers.get('set-cookie')).toMatch(/__session=sess/);
      },
    });
    expect(setPortalUserClaims).toHaveBeenCalledWith('hash-a@b.com', {
      role: 'family',
      familyId: '42',
      email: 'a@b.com',
    });
  });

  it('returns customToken on mobile mode', async () => {
    happyPathMocks();
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'email',
            value: 'a@b.com',
            code: '123456',
            mode: 'mobile',
          }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.customToken).toBe('ctok');
        expect(res.headers.get('set-cookie')).toBeNull();
      },
    });
  });
});
