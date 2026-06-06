import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@cmt/firebase-shared/admin/session', () => ({
  verifyPortalSessionCookie: vi.fn(),
  verifyPortalIdToken: vi.fn(),
}));

import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
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
// family-manager: GET /api/setu/family passes through
// ─────────────────────────────────────────────────────────────────────────────

describe('family-manager GET /api/setu/family', () => {
  it('forwards x-portal-* on the REQUEST headers (not leaked on the response)', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mgr',
      role: 'family-manager',
      fid: 'FAMA0001ABCD',
      mid: 'FAMA0001ABCD-01',
    });

    const res = await middleware(
      makeReq('http://localhost/api/setu/family', { cookie: 'good', method: 'GET' }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-x-portal-role')).toBe('family-manager');
    expect(res.headers.get('x-middleware-request-x-portal-fid')).toBe('FAMA0001ABCD');
    expect(res.headers.get('x-middleware-request-x-portal-mid')).toBe('FAMA0001ABCD-01');
    // SECURITY: must NOT leak the claims onto the client-facing response headers.
    expect(res.headers.get('x-portal-role')).toBeNull();
    expect(res.headers.get('x-portal-fid')).toBeNull();
    expect(res.headers.get('x-portal-mid')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// family-member: GET /api/setu/family passes through
// ─────────────────────────────────────────────────────────────────────────────

describe('family-member GET /api/setu/family', () => {
  it('passes through — read access is allowed for members', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mem',
      role: 'family-member',
      fid: 'FAMA0001ABCD',
      mid: 'FAMA0001ABCD-02',
    });

    const res = await middleware(
      makeReq('http://localhost/api/setu/family', { cookie: 'good', method: 'GET' }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-x-portal-role')).toBe('family-member');
    expect(res.headers.get('x-portal-role')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// family-member: POST /api/setu/members → 401 (manager-only, method-aware)
// ─────────────────────────────────────────────────────────────────────────────

describe('family-member POST /api/setu/members (method-aware guard)', () => {
  it('returns 401 unauthorized — POST is manager-only', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mem',
      role: 'family-member',
      fid: 'FAMA0001ABCD',
      mid: 'FAMA0001ABCD-02',
    });

    const res = await middleware(
      makeReq('http://localhost/api/setu/members', { cookie: 'good', method: 'POST' }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized|forbidden/);
  });

  it('family-manager POST /api/setu/members passes through', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mgr',
      role: 'family-manager',
      fid: 'FAMA0001ABCD',
      mid: 'FAMA0001ABCD-01',
    });

    const res = await middleware(
      makeReq('http://localhost/api/setu/members', { cookie: 'good', method: 'POST' }),
    );

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// family-member: PATCH /api/setu/members/<other-mid> → 401 (not own profile)
// ─────────────────────────────────────────────────────────────────────────────

describe('family-member PATCH /api/setu/members/<other-mid> (method-aware guard)', () => {
  it('returns 401 when patching a different member mid', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mem',
      role: 'family-member',
      fid: 'FAMA0001ABCD',
      mid: 'FAMA0001ABCD-02',
    });

    // Patching FAMA0001ABCD-01, not their own mid
    const res = await middleware(
      makeReq('http://localhost/api/setu/members/FAMA0001ABCD-01', {
        cookie: 'good',
        method: 'PATCH',
      }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized|forbidden/);
  });

  it('family-member PATCH /api/setu/members/{their-own-mid} passes through', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mem',
      role: 'family-member',
      fid: 'FAMA0001ABCD',
      mid: 'FAMA0001ABCD-02',
    });

    // Patching own mid
    const res = await middleware(
      makeReq('http://localhost/api/setu/members/FAMA0001ABCD-02', {
        cookie: 'good',
        method: 'PATCH',
      }),
    );

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// family-member: DELETE /api/setu/members/:mid → 401 (manager-only)
// ─────────────────────────────────────────────────────────────────────────────

describe('family-member DELETE /api/setu/members/:mid (method-aware guard)', () => {
  it('returns 401 — DELETE is manager-only', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mem',
      role: 'family-member',
      fid: 'FAMA0001ABCD',
      mid: 'FAMA0001ABCD-02',
    });

    const res = await middleware(
      makeReq('http://localhost/api/setu/members/FAMA0001ABCD-01', {
        cookie: 'good',
        method: 'DELETE',
      }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized|forbidden/);
  });

  it('family-manager DELETE /api/setu/members/:mid passes through', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-mgr',
      role: 'family-manager',
      fid: 'FAMA0001ABCD',
      mid: 'FAMA0001ABCD-01',
    });

    const res = await middleware(
      makeReq('http://localhost/api/setu/members/FAMA0001ABCD-02', {
        cookie: 'good',
        method: 'DELETE',
      }),
    );

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// welcome-team: GET /api/setu/family → 401 (welcome-team is not a family role)
// ─────────────────────────────────────────────────────────────────────────────

describe('welcome-team GET /api/setu/family', () => {
  it('returns 401 — welcome-team cannot access /api/setu/family', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-wt',
      role: 'welcome-team',
    });

    const res = await middleware(
      makeReq('http://localhost/api/setu/family', { cookie: 'good', method: 'GET' }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/);
  });

  it('welcome-team can access /api/setu/family/search (search endpoint)', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-wt',
      role: 'welcome-team',
    });

    const res = await middleware(
      makeReq('http://localhost/api/setu/family/search?q=patel', { cookie: 'good', method: 'GET' }),
    );

    // welcome-team has broader /api/setu/* access; search is allowed
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No session: API routes return 401 JSON (not redirect)
// ─────────────────────────────────────────────────────────────────────────────

describe('unauthenticated requests to CRUD API routes', () => {
  it('GET /api/setu/family with no auth returns 401 JSON', async () => {
    const res = await middleware(makeReq('http://localhost/api/setu/family', { method: 'GET' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });

  it('POST /api/setu/members with no auth returns 401 JSON', async () => {
    const res = await middleware(makeReq('http://localhost/api/setu/members', { method: 'POST' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });

  it('PATCH /api/setu/members/:mid with no auth returns 401 JSON', async () => {
    const res = await middleware(
      makeReq('http://localhost/api/setu/members/FAMA0001ABCD-01', { method: 'PATCH' }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });

  it('DELETE /api/setu/members/:mid with no auth returns 401 JSON', async () => {
    const res = await middleware(
      makeReq('http://localhost/api/setu/members/FAMA0001ABCD-01', { method: 'DELETE' }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wrong role on API routes (e.g. teacher)
// ─────────────────────────────────────────────────────────────────────────────

describe('wrong role on setu CRUD API routes', () => {
  it('teacher GET /api/setu/family → 401 unauthorized JSON', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-teacher',
      role: 'teacher',
    });

    const res = await middleware(
      makeReq('http://localhost/api/setu/family', { cookie: 'good', method: 'GET' }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('legacy family role GET /api/setu/family → 401 unauthorized', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u-legacy',
      role: 'family',
      familyId: '42',
    });

    const res = await middleware(
      makeReq('http://localhost/api/setu/family', { cookie: 'good', method: 'GET' }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Expired / invalid session cookie → no-session
// ─────────────────────────────────────────────────────────────────────────────

describe('expired or invalid session cookie on CRUD routes', () => {
  it('GET /api/setu/family with invalid cookie → 401 no-session JSON', async () => {
    (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const res = await middleware(
      makeReq('http://localhost/api/setu/family', { cookie: 'expired', method: 'GET' }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });
});
