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

const makeReq = (
  url: string,
  init: { cookie?: string; bearer?: string; method?: string } = {},
) => {
  const headers = new Headers();
  if (init.bearer) headers.set('authorization', `Bearer ${init.bearer}`);
  if (init.cookie) headers.set('cookie', `__session=${init.cookie}`);
  return new NextRequest(new URL(url, 'http://localhost'), {
    headers,
    method: init.method ?? 'GET',
  });
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
  it('forwards x-portal-* on the REQUEST headers (not leaked on the response)', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mgr',
      role: 'family-manager',
      fid: 'FAM001',
      mid: 'FAM001-01',
    });
    const res = await middleware(makeReq('http://localhost/family', { cookie: 'good' }));
    expect(res.status).toBe(200);
    // Forwarded to the downstream handler via the request headers. Next encodes
    // NextResponse.next({ request: { headers } }) as x-middleware-request-*.
    expect(res.headers.get('x-middleware-request-x-portal-role')).toBe('family-manager');
    expect(res.headers.get('x-middleware-request-x-portal-uid')).toBe('u-mgr');
    expect(res.headers.get('x-middleware-request-x-portal-fid')).toBe('FAM001');
    expect(res.headers.get('x-middleware-request-x-portal-mid')).toBe('FAM001-01');
    // SECURITY: must NOT leak the claims onto the client-facing response headers.
    expect(res.headers.get('x-portal-role')).toBeNull();
    expect(res.headers.get('x-portal-uid')).toBeNull();
    expect(res.headers.get('x-portal-fid')).toBeNull();
    expect(res.headers.get('x-portal-mid')).toBeNull();
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
    expect(res.headers.get('x-middleware-request-x-portal-role')).toBe('family-member');
    expect(res.headers.get('x-portal-role')).toBeNull();
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
    expect(res.headers.get('x-middleware-request-x-portal-family-id')).toBe('42');
    expect(res.headers.get('x-portal-family-id')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Method-aware: family-member denied POST/PATCH/DELETE on /api/setu/members
// ─────────────────────────────────────────────────────────────────────────────

describe('Method-aware: /api/setu/members mutations denied for family-member', () => {
  it('family-member POST /api/setu/members → 401 unauthorized', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mem',
      role: 'family-member',
      fid: 'FAM001',
      mid: 'FAM001-02',
    });
    const res = await middleware(
      makeReq('http://localhost/api/setu/members', { cookie: 'good', method: 'POST' }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('family-member PATCH /api/setu/members/FAM001-02 (own mid) → 200 self-edit allowed', async () => {
    // Self-edit: session mid matches the path mid — middleware allows through.
    // Route handler enforces that manager flag cannot be changed.
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mem',
      role: 'family-member',
      fid: 'FAM001',
      mid: 'FAM001-02',
    });
    const res = await middleware(
      makeReq('http://localhost/api/setu/members/FAM001-02', { cookie: 'good', method: 'PATCH' }),
    );
    expect(res.status).toBe(200);
  });

  it('family-member PATCH /api/setu/members/FAM001-01 (other member) → 401 unauthorized', async () => {
    // Editing a different member's mid — blocked at middleware.
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mem',
      role: 'family-member',
      fid: 'FAM001',
      mid: 'FAM001-02',
    });
    const res = await middleware(
      makeReq('http://localhost/api/setu/members/FAM001-01', { cookie: 'good', method: 'PATCH' }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('family-member DELETE /api/setu/members/FAM001-02 → 401 unauthorized', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mem',
      role: 'family-member',
      fid: 'FAM001',
      mid: 'FAM001-02',
    });
    const res = await middleware(
      makeReq('http://localhost/api/setu/members/FAM001-02', {
        cookie: 'good',
        method: 'DELETE',
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('family-member GET /api/setu/members → 200 (read-only is allowed)', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mem',
      role: 'family-member',
      fid: 'FAM001',
      mid: 'FAM001-02',
    });
    const res = await middleware(
      makeReq('http://localhost/api/setu/members', { cookie: 'good', method: 'GET' }),
    );
    expect(res.status).toBe(200);
  });

  it('family-manager POST /api/setu/members → 200 (manager can mutate)', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mgr',
      role: 'family-manager',
      fid: 'FAM001',
      mid: 'FAM001-01',
    });
    const res = await middleware(
      makeReq('http://localhost/api/setu/members', { cookie: 'good', method: 'POST' }),
    );
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth-entry pages — redirect signed-in users to their dashboard
// ─────────────────────────────────────────────────────────────────────────────

describe('Auth-entry pages redirect signed-in users to their dashboard', () => {
  it.each([
    ['/', 'family-manager', '/family'],
    ['/', 'family-member', '/family'],
    ['/', 'welcome-team', '/welcome'],
    ['/sign-in', 'family-manager', '/family'],
    ['/sign-in', 'welcome-team', '/welcome'],
    ['/register', 'family-manager', '/family'],
    ['/register/family', 'family-member', '/family'],
  ])('%s with role=%s → redirects to %s', async (from, role, expected) => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-1',
      role,
      ...(role.startsWith('family') ? { fid: 'FAM001', mid: 'FAM001-01' } : {}),
    });
    const res = await middleware(makeReq(`http://localhost${from}`, { cookie: 'good' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`http://localhost${expected}`);
  });

  it('signed-out visitor to / passes through (no redirect)', async () => {
    const res = await middleware(makeReq('http://localhost/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(verifyPortalSessionCookie).not.toHaveBeenCalled();
  });

  it('invalid session cookie on / passes through (no redirect)', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await middleware(makeReq('http://localhost/', { cookie: 'bad' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('verify throwing on / passes through (no redirect)', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const res = await middleware(makeReq('http://localhost/', { cookie: 'maybe' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('honors ?from= when signed-in user lands on /sign-in (invite-accept flow)', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-1', role: 'family-manager', fid: 'FAM001', mid: 'FAM001-01',
    });
    const res = await middleware(
      makeReq('http://localhost/sign-in?from=/invite/abc123', { cookie: 'good' }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/invite/abc123');
  });

  it('rejects protocol-relative ?from= (open-redirect guard)', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-1', role: 'family-manager', fid: 'FAM001', mid: 'FAM001-01',
    });
    const res = await middleware(
      makeReq('http://localhost/sign-in?from=//evil.com/bad', { cookie: 'good' }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/family');
  });

  it('rejects absolute URL ?from= (open-redirect guard)', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-1', role: 'welcome-team',
    });
    const res = await middleware(
      makeReq('http://localhost/?from=https://evil.com', { cookie: 'good' }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/welcome');
  });
});
