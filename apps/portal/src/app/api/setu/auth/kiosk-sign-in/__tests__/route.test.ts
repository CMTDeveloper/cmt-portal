import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

vi.mock('@/features/setu/auth/mint-password-session', () => ({
  mintPasswordSession: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return actual;
});

import { POST } from '../route';
import { mintPasswordSession } from '@/features/setu/auth/mint-password-session';

const mockedMint = vi.mocked(mintPasswordSession);

function makeRequest(body: unknown, url = 'http://localhost/api/setu/auth/kiosk-sign-in') {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Standard "session minted, kiosk role" success shape from the helper. */
function kioskSessionResult() {
  return {
    status: 'session' as const,
    redirectTo: '/check-in',
    cookieValue: 'session-cookie-kiosk',
    maxAgeSeconds: 14 * 24 * 60 * 60,
    uid: 'uid-kiosk',
    claims: { role: 'kiosk', email: 'kiosk@example.com' },
  };
}

const OLD_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KIOSK_ACCOUNT_EMAIL = 'kiosk@example.com';
  delete process.env.KIOSK_USERNAME;
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe('POST /api/setu/auth/kiosk-sign-in', () => {
  it('400 on missing username', async () => {
    const res = await POST(makeRequest({ password: 'secret' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad-request' });
  });

  it('400 on empty password', async () => {
    const res = await POST(makeRequest({ username: 'sevak', password: '' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad-request' });
  });

  it('valid sevak + correct password: 200 + __session cookie + redirectTo /check-in', async () => {
    mockedMint.mockResolvedValue(kioskSessionResult());

    const res = await POST(makeRequest({ username: 'sevak', password: 'secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectTo: '/check-in' });
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain('__session=session-cookie-kiosk');
    // Kiosk always signs in web-mode against the resolved kiosk email.
    expect(mockedMint).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'kiosk@example.com', password: 'secret', mode: 'web' }),
    );
  });

  it('wrong username: 401 invalid-credentials, no cookie, mint NOT called', async () => {
    const res = await POST(makeRequest({ username: 'not-sevak', password: 'secret' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid-credentials' });
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(mockedMint).not.toHaveBeenCalled();
  });

  it('honors a custom KIOSK_USERNAME env override', async () => {
    process.env.KIOSK_USERNAME = 'doorstaff';
    mockedMint.mockResolvedValue(kioskSessionResult());

    const ok = await POST(makeRequest({ username: 'doorstaff', password: 'secret' }));
    expect(ok.status).toBe(200);

    const bad = await POST(makeRequest({ username: 'sevak', password: 'secret' }));
    expect(bad.status).toBe(401);
  });

  it('wrong password (helper returns 401): 401 invalid-credentials, no cookie', async () => {
    mockedMint.mockResolvedValue({
      status: 'error',
      httpStatus: 401,
      error: 'invalid-credentials',
    });

    const res = await POST(makeRequest({ username: 'sevak', password: 'wrong' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid-credentials' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('collapses user-disabled (403 from helper) to 401 invalid-credentials (no leak)', async () => {
    mockedMint.mockResolvedValue({ status: 'error', httpStatus: 403, error: 'user-disabled' });

    const res = await POST(makeRequest({ username: 'sevak', password: 'secret' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid-credentials' });
  });

  it('collapses network (500 from helper) to 401 invalid-credentials (no leak)', async () => {
    mockedMint.mockResolvedValue({ status: 'error', httpStatus: 500, error: 'network' });

    const res = await POST(makeRequest({ username: 'sevak', password: 'secret' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid-credentials' });
  });

  it('passes 429 through distinctly with resetAt (rate-limit is surfaced)', async () => {
    mockedMint.mockResolvedValue({
      status: 'error',
      httpStatus: 429,
      error: 'too-many-requests',
      resetAt: '2026-05-25T00:00:00Z',
    });

    const res = await POST(makeRequest({ username: 'sevak', password: 'secret' }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'too-many-requests', resetAt: '2026-05-25T00:00:00Z' });
  });

  it('500 server-misconfigured when KIOSK_ACCOUNT_EMAIL unset, mint NOT called', async () => {
    delete process.env.KIOSK_ACCOUNT_EMAIL;

    const res = await POST(makeRequest({ username: 'sevak', password: 'secret' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server-misconfigured' });
    expect(mockedMint).not.toHaveBeenCalled();
  });

  it('honors safe ?from=/check-in/guest in redirectTo', async () => {
    mockedMint.mockResolvedValue({ ...kioskSessionResult(), redirectTo: '/check-in/guest' });

    const res = await POST(
      makeRequest(
        { username: 'sevak', password: 'secret' },
        'http://localhost/api/setu/auth/kiosk-sign-in?from=/check-in/guest',
      ),
    );
    expect((await res.json()).redirectTo).toBe('/check-in/guest');
    // The safe from is forwarded to the helper too.
    expect(mockedMint).toHaveBeenCalledWith(
      expect.objectContaining({ from: '/check-in/guest' }),
    );
  });

  it('rejects unsafe ?from=//evil.com — falls back to /check-in', async () => {
    // Even if the helper echoes a hostile redirectTo, the route re-applies the
    // /check-in default for any unsafe from.
    mockedMint.mockResolvedValue({ ...kioskSessionResult(), redirectTo: '//evil.com' });

    const res = await POST(
      makeRequest(
        { username: 'sevak', password: 'secret' },
        'http://localhost/api/setu/auth/kiosk-sign-in?from=//evil.com',
      ),
    );
    expect((await res.json()).redirectTo).toBe('/check-in');
  });

  it('rejects unsafe ?from=https://x — falls back to /check-in', async () => {
    mockedMint.mockResolvedValue({ ...kioskSessionResult(), redirectTo: '/check-in' });

    const res = await POST(
      makeRequest(
        { username: 'sevak', password: 'secret' },
        'http://localhost/api/setu/auth/kiosk-sign-in?from=https://x',
      ),
    );
    expect((await res.json()).redirectTo).toBe('/check-in');
  });

  it('403 forbidden when helper mints a NON-kiosk role', async () => {
    mockedMint.mockResolvedValue({
      status: 'session',
      redirectTo: '/family',
      cookieValue: 'session-cookie-family',
      maxAgeSeconds: 14 * 24 * 60 * 60,
      uid: 'uid-fam',
      claims: { role: 'family-manager', fid: 'CMT-001' },
    });

    const res = await POST(makeRequest({ username: 'sevak', password: 'secret' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('treats pending-approval defensively as 401 invalid-credentials', async () => {
    mockedMint.mockResolvedValue({
      status: 'pending-approval',
      pendingFid: 'CMT-001',
      pendingMatchedMid: 'CMT-001-02',
    });

    const res = await POST(makeRequest({ username: 'sevak', password: 'secret' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid-credentials' });
  });

  it('treats no-session defensively as 401 invalid-credentials', async () => {
    mockedMint.mockResolvedValue({ status: 'no-session', redirectTo: '/register?contact=verified' });

    const res = await POST(makeRequest({ username: 'sevak', password: 'secret' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid-credentials' });
  });

  it('treats mobile defensively as 401 invalid-credentials', async () => {
    mockedMint.mockResolvedValue({ status: 'mobile', customToken: 'ct' });

    const res = await POST(makeRequest({ username: 'sevak', password: 'secret' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid-credentials' });
  });

  it('404 when setuAuth flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: GatedPost } = await import('../route');
    const res = await GatedPost(makeRequest({ username: 'sevak', password: 'secret' }));
    expect(res.status).toBe(404);
    vi.doUnmock('@/lib/flags');
    vi.resetModules();
  });
});
