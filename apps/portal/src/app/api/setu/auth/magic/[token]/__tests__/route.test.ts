import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/setu/auth/magic-links', () => ({
  consumeMagicLink: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  createPortalSessionCookie: vi.fn(),
  exchangeCustomTokenForIdToken: vi.fn(),
}));
vi.mock('@/features/setu/auth/build-session-claims', () => ({
  buildSessionClaimsForContact: vi.fn(),
  hasSession: vi.fn(),
}));

import { GET } from '../route';
import { consumeMagicLink } from '@/features/setu/auth/magic-links';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';
import type { BuildSessionClaimsResult } from '@/features/setu/auth/build-session-claims';
import {
  buildSessionClaimsForContact,
  hasSession,
} from '@/features/setu/auth/build-session-claims';

const mockHasSession = hasSession as unknown as MockedFunction<(r: BuildSessionClaimsResult) => boolean>;
const mockSetCustomUserClaims = vi.fn();
const mockCreateCustomToken = vi.fn();

function makeRequest(token: string, search = '') {
  return new Request(`http://localhost/api/setu/auth/magic/${token}${search}`);
}

function makeParams(token: string): { params: Promise<{ token: string }> } {
  return { params: Promise.resolve({ token }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  (portalAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    setCustomUserClaims: mockSetCustomUserClaims,
    createCustomToken: mockCreateCustomToken,
  });
  mockSetCustomUserClaims.mockResolvedValue(undefined);
  mockCreateCustomToken.mockResolvedValue('custom-token');
  (exchangeCustomTokenForIdToken as ReturnType<typeof vi.fn>).mockResolvedValue('id-token');
  (createPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValue('session-cookie');
});

describe('GET /api/setu/auth/magic/[token]', () => {
  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { GET: flaggedGET } = await import('../route');
    const res = await flaggedGET(makeRequest('tok'), makeParams('tok'));
    expect(res.status).toBe(404);
  });

  it('redirects to /sign-in?error=magic-link-invalid when token not found', async () => {
    (consumeMagicLink as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(makeRequest('badtoken'), makeParams('badtoken'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/sign-in');
    expect(res.headers.get('location')).toContain('magic-link-invalid');
  });

  it('redirects to /sign-in?error=magic-link-invalid when token expired or already used', async () => {
    (consumeMagicLink as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(makeRequest('usedtoken'), makeParams('usedtoken'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('magic-link-invalid');
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('redirects to /register when no family for email', async () => {
    (consumeMagicLink as ReturnType<typeof vi.fn>).mockResolvedValue({ email: 'new@example.com' });
    (buildSessionClaimsForContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      redirectTo: '/register?contact=verified',
    });
    mockHasSession.mockReturnValue(false);
    const res = await GET(makeRequest('validtok'), makeParams('validtok'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/register');
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('sets session cookie and redirects to /family on valid manager token', async () => {
    (consumeMagicLink as ReturnType<typeof vi.fn>).mockResolvedValue({ email: 'raj@example.com' });
    (buildSessionClaimsForContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      uid: 'uid-raj',
      claims: { role: 'family-manager', fid: 'FAM001', mid: 'FAM001-01', email: 'raj@example.com' },
      redirectTo: '/family',
    });
    mockHasSession.mockReturnValue(true);
    const res = await GET(makeRequest('validtok'), makeParams('validtok'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/family');
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'uid-raj',
      expect.objectContaining({ role: 'family-manager', fid: 'FAM001' }),
    );
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('__session');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toMatch(/samesite=lax/i);
  });

  it('calls buildSessionClaimsForContact with contactProvenance=magic-link', async () => {
    (consumeMagicLink as ReturnType<typeof vi.fn>).mockResolvedValue({ email: 'raj@example.com' });
    (buildSessionClaimsForContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      uid: 'uid-raj',
      claims: { role: 'family-manager' },
      redirectTo: '/family',
    });
    mockHasSession.mockReturnValue(true);
    await GET(makeRequest('validtok'), makeParams('validtok'));
    expect(buildSessionClaimsForContact).toHaveBeenCalledWith({
      type: 'email',
      value: 'raj@example.com',
      contactProvenance: 'magic-link',
    });
  });

  it('honors safe ?from= param over default redirect', async () => {
    (consumeMagicLink as ReturnType<typeof vi.fn>).mockResolvedValue({ email: 'raj@example.com' });
    (buildSessionClaimsForContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      uid: 'uid-raj',
      claims: { role: 'family-manager' },
      redirectTo: '/family',
    });
    mockHasSession.mockReturnValue(true);
    const res = await GET(
      makeRequest('validtok', '?from=/invite/abc123'),
      makeParams('validtok'),
    );
    expect(res.headers.get('location')).toContain('/invite/abc123');
  });

  it('happy path with admin (no family) → redirects to /admin', async () => {
    (consumeMagicLink as ReturnType<typeof vi.fn>).mockResolvedValue({ email: 'admin@example.com' });
    (buildSessionClaimsForContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      uid: 'uid-admin',
      claims: { role: 'admin', email: 'admin@example.com' },
      redirectTo: '/admin',
    });
    mockHasSession.mockReturnValue(true);
    const res = await GET(makeRequest('admintok'), makeParams('admintok'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/admin');
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'uid-admin',
      expect.objectContaining({ role: 'admin' }),
    );
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('__session');
  });

  it('ignores unsafe ?from= (open-redirect guard)', async () => {
    (consumeMagicLink as ReturnType<typeof vi.fn>).mockResolvedValue({ email: 'raj@example.com' });
    (buildSessionClaimsForContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      uid: 'uid-raj',
      claims: { role: 'family-manager' },
      redirectTo: '/family',
    });
    mockHasSession.mockReturnValue(true);
    for (const bad of ['//evil.com', 'https://evil.com', 'http://evil.com/steal']) {
      const res = await GET(
        makeRequest('validtok', `?from=${encodeURIComponent(bad)}`),
        makeParams('validtok'),
      );
      expect(res.headers.get('location')).not.toContain('evil.com');
      expect(res.headers.get('location')).toContain('/family');
    }
  });
});
