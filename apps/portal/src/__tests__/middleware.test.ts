import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@cmt/firebase-shared/admin/session', () => ({
  verifyPortalSessionCookie: vi.fn(),
  verifyPortalIdToken: vi.fn(),
}));

import {
  verifyPortalSessionCookie,
  verifyPortalIdToken,
} from '@cmt/firebase-shared/admin/session';
import { middleware } from '../middleware';

const makeReq = (url: string, init: { cookie?: string; bearer?: string } = {}) => {
  const headers = new Headers();
  if (init.bearer) headers.set('authorization', `Bearer ${init.bearer}`);
  if (init.cookie) headers.set('cookie', `__session=${init.cookie}`);
  return new NextRequest(new URL(url, 'http://localhost'), { headers });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('middleware — public routes', () => {
  it('passes through /login without auth', async () => {
    const res = await middleware(makeReq('http://localhost/login'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('passes through /check-in (kiosk)', async () => {
    const res = await middleware(makeReq('http://localhost/check-in'));
    expect(res.status).toBe(200);
  });
});

describe('middleware — cookie auth', () => {
  it('attaches claims headers when cookie is valid', async () => {
    (verifyPortalSessionCookie as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u1',
      role: 'admin',
    });
    const res = await middleware(makeReq('http://localhost/check-in/admin', { cookie: 'good' }));
    expect(res.status).toBe(200);
  });

  it('redirects to /login when no cookie and route is protected', async () => {
    const res = await middleware(makeReq('http://localhost/check-in/admin'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/login\?from=%2Fcheck-in%2Fadmin/);
    expect(res.headers.get('location')).toMatch(/error=session-expired/);
  });

  it('redirects to /login?error=unauthorized when role is wrong', async () => {
    (verifyPortalSessionCookie as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u1',
      role: 'teacher',
    });
    const res = await middleware(makeReq('http://localhost/check-in/admin', { cookie: 'good' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/error=unauthorized/);
  });
});

describe('middleware — bearer auth', () => {
  it('accepts a valid Bearer ID token', async () => {
    (verifyPortalIdToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u2',
      role: 'admin',
    });
    const res = await middleware(
      makeReq('http://localhost/api/check-in/admin/stats', { bearer: 'tok' }),
    );
    expect(res.status).toBe(200);
  });

  it('returns 401 JSON for /api/* on missing auth', async () => {
    const res = await middleware(makeReq('http://localhost/api/check-in/admin/stats'));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });

  it('returns 401 JSON for /api/* on role mismatch', async () => {
    (verifyPortalIdToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u2',
      role: 'family',
    });
    const res = await middleware(
      makeReq('http://localhost/api/check-in/admin/stats', { bearer: 'tok' }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('returns 401 on invalid Bearer token', async () => {
    (verifyPortalIdToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await middleware(
      makeReq('http://localhost/api/check-in/admin/stats', { bearer: 'bad' }),
    );
    expect(res.status).toBe(401);
  });
});
