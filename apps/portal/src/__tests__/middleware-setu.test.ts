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

// ─────────────────────────────────────────────────────────────────────────────
// Setu public routes — no auth required
// ─────────────────────────────────────────────────────────────────────────────

describe('Setu public routes pass through unauthenticated', () => {
  it('/sign-in is public', async () => {
    const res = await middleware(makeReq('http://localhost/sign-in'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('/register is public', async () => {
    const res = await middleware(makeReq('http://localhost/register'));
    expect(res.status).toBe(200);
  });

  it('/register/family is public', async () => {
    const res = await middleware(makeReq('http://localhost/register/family'));
    expect(res.status).toBe(200);
  });

  it('/invite/:token is public', async () => {
    const res = await middleware(makeReq('http://localhost/invite/abc123'));
    expect(res.status).toBe(200);
  });

  it('/api/setu/auth/send-code is public', async () => {
    const res = await middleware(makeReq('http://localhost/api/setu/auth/send-code'));
    expect(res.status).toBe(200);
  });

  it('/api/setu/auth/verify-code is public', async () => {
    const res = await middleware(makeReq('http://localhost/api/setu/auth/verify-code'));
    expect(res.status).toBe(200);
  });

  it('/api/setu/auth/signout is public', async () => {
    const res = await middleware(makeReq('http://localhost/api/setu/auth/signout'));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /family/* redirects to /sign-in (not /login) when unauthenticated
// ─────────────────────────────────────────────────────────────────────────────

describe('Unauthenticated /family/* redirects to /sign-in', () => {
  it('GET /family → 307 to /sign-in (not /login)', async () => {
    const res = await middleware(makeReq('http://localhost/family'));
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/sign-in');
    expect(location).not.toContain('/login');
    expect(location).toContain('from=%2Ffamily');
    expect(location).toContain('error=session-expired');
  });

  it('GET /family/members → 307 to /sign-in with encoded from param', async () => {
    const res = await middleware(makeReq('http://localhost/family/members'));
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/sign-in');
    expect(location).toContain('from=%2Ffamily%2Fmembers');
    expect(location).toContain('error=session-expired');
  });

  it('GET /family/members/FAM001-02 → 307 to /sign-in', async () => {
    const res = await middleware(makeReq('http://localhost/family/members/FAM001-02'));
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/sign-in');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Legacy /check-in/admin still redirects to /login (not /sign-in)
// ─────────────────────────────────────────────────────────────────────────────

describe('Legacy /check-in/* still redirects to /login', () => {
  it('GET /check-in/admin unauthenticated → /login (not /sign-in)', async () => {
    const res = await middleware(makeReq('http://localhost/check-in/admin'));
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).not.toContain('/sign-in');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// family-manager passes through /family and gets headers
// ─────────────────────────────────────────────────────────────────────────────

describe('Authenticated family-manager on /family/*', () => {
  it('passes through, sets x-portal-role, x-portal-uid, x-portal-fid, x-portal-mid', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mgr',
      role: 'family-manager',
      fid: 'FAM001',
      mid: 'FAM001-01',
    });
    const res = await middleware(makeReq('http://localhost/family', { cookie: 'good' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-portal-role')).toBe('family-manager');
    expect(res.headers.get('x-portal-uid')).toBe('u-mgr');
    expect(res.headers.get('x-portal-fid')).toBe('FAM001');
    expect(res.headers.get('x-portal-mid')).toBe('FAM001-01');
  });

  it('family-manager can access /family/members', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mgr',
      role: 'family-manager',
      fid: 'FAM001',
      mid: 'FAM001-01',
    });
    const res = await middleware(makeReq('http://localhost/family/members', { cookie: 'good' }));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// family-member passes through /family/*
// ─────────────────────────────────────────────────────────────────────────────

describe('Authenticated family-member on /family/*', () => {
  it('passes through /family/members', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mem',
      role: 'family-member',
      fid: 'FAM001',
      mid: 'FAM001-02',
    });
    const res = await middleware(makeReq('http://localhost/family/members', { cookie: 'good' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-portal-role')).toBe('family-member');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// welcome-team: DENIED on /family/* (welcome-team views welcome, not family)
// ─────────────────────────────────────────────────────────────────────────────

describe('welcome-team on /family/* is denied', () => {
  it('welcome-team gets 307 unauthorized on /family', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-wt',
      role: 'welcome-team',
    });
    const res = await middleware(makeReq('http://localhost/family', { cookie: 'good' }));
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('error=unauthorized');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// welcome-team: allowed on /welcome/*
// ─────────────────────────────────────────────────────────────────────────────

describe('welcome-team on /welcome/*', () => {
  it('passes through /welcome', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-wt',
      role: 'welcome-team',
    });
    const res = await middleware(makeReq('http://localhost/welcome', { cookie: 'good' }));
    expect(res.status).toBe(200);
  });

  it('family-manager is denied /welcome', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mgr',
      role: 'family-manager',
      fid: 'FAM001',
      mid: 'FAM001-01',
    });
    const res = await middleware(makeReq('http://localhost/welcome', { cookie: 'good' }));
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('error=unauthorized');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/setu/* with no auth → 401 JSON (not redirect)
// ─────────────────────────────────────────────────────────────────────────────

describe('API routes return 401 JSON on missing/wrong auth', () => {
  it('GET /api/setu/family with no auth → 401 JSON', async () => {
    const res = await middleware(makeReq('http://localhost/api/setu/family'));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });

  it('GET /api/setu/family with wrong role → 401 JSON unauthorized', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-teacher',
      role: 'teacher',
    });
    const res = await middleware(
      makeReq('http://localhost/api/setu/family', { cookie: 'good' }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// x-portal-family-id header: legacy familyId still forwarded
// ─────────────────────────────────────────────────────────────────────────────

describe('legacy familyId header forwarded', () => {
  it('x-portal-family-id set when claims.familyId present', async () => {
    (verifyPortalIdToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-fam',
      role: 'family',
      familyId: '42',
    });
    const res = await middleware(
      makeReq('http://localhost/check-in/family', { bearer: 'tok' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-portal-family-id')).toBe('42');
  });
});
