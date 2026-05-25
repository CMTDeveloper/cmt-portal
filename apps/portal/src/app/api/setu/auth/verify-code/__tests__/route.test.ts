import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/check-in/shared', () => ({
  normalizeContact: vi.fn((type: string, value: string) =>
    type === 'email' ? value.toLowerCase().trim() : value.replace(/\D/g, ''),
  ),
  sha256Hex: vi.fn((s: string) => `hash:${s}`),
  verifyCode: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  createPortalSessionCookie: vi.fn(),
  exchangeCustomTokenForIdToken: vi.fn(),
}));
vi.mock('@/features/setu/auth/find-family-by-contact', () => ({
  findSetuFamilyByContact: vi.fn(),
}));
vi.mock('@/features/setu/registration/lazy-migrate', () => ({
  lazyMigrateLegacyFamily: vi.fn(),
}));
vi.mock('@/features/setu/auth/member-roles', () => ({
  getMemberRoles: vi.fn(async () => []),
}));

import { POST } from '../route';
import { verifyCode } from '@/features/check-in/shared';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';
import { lazyMigrateLegacyFamily } from '@/features/setu/registration/lazy-migrate';

const mockGetUser = vi.fn();
const mockCreateUser = vi.fn();
const mockSetCustomUserClaims = vi.fn();
const mockCreateCustomToken = vi.fn();

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/setu/auth/verify-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (portalAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    getUser: mockGetUser,
    createUser: mockCreateUser,
    setCustomUserClaims: mockSetCustomUserClaims,
    createCustomToken: mockCreateCustomToken,
  });
  mockGetUser.mockResolvedValue({ uid: 'hash:raj@example.com' });
  mockSetCustomUserClaims.mockResolvedValue(undefined);
  mockCreateCustomToken.mockResolvedValue('custom-token');
  (exchangeCustomTokenForIdToken as ReturnType<typeof vi.fn>).mockResolvedValue('id-token');
  (createPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValue('session-cookie');
});

describe('POST /api/setu/auth/verify-code', () => {
  it('returns 400 on bad payload', async () => {
    const res = await POST(makeRequest({ foo: 'bar' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on wrong code', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await POST(makeRequest({ type: 'email', value: 'raj@example.com', code: '000000' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid-or-expired');
  });

  it('correct code with Setu hit (manager) sets cookie and redirects to /family', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-01', legacyFid: null, family: {},
      member: { manager: true },
    });
    const res = await POST(makeRequest({ type: 'email', value: 'raj@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe('/family');
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'hash:raj@example.com',
      expect.objectContaining({ role: 'family-manager', fid: 'FAM001', mid: 'FAM001-01' }),
    );
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('__session');
  });

  it('correct code with Setu hit (non-manager) assigns family-member role', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-02', legacyFid: null, family: {},
      member: { manager: false },
    });
    const res = await POST(makeRequest({ type: 'email', value: 'aarti@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family-member', fid: 'FAM001', mid: 'FAM001-02' }),
    );
  });

  it('legacy hit: migration fails → falls back to legacy claims and /register', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'legacy', fid: null, mid: null, legacyFid: '42', family: {},
    });
    (lazyMigrateLegacyFamily as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('RTDB error'));
    const res = await POST(makeRequest({ type: 'email', value: 'sharma@example.com', code: '654321' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe('/register?contact=verified');
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family', familyId: '42' }),
    );
  });

  it('legacy hit: migration succeeds → re-lookup returns Setu hit → redirects to /family', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    // First call: legacy hit
    // Second call (post-migration): setu hit
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ source: 'legacy', fid: null, mid: null, legacyFid: '42', family: {} })
      .mockResolvedValueOnce({ source: 'setu', fid: 'FAMNEW', mid: 'FAMNEW-01', legacyFid: '42', family: {}, member: { manager: true } });
    (lazyMigrateLegacyFamily as ReturnType<typeof vi.fn>).mockResolvedValue({ migrated: true, fid: 'FAMNEW', legacyFid: '42' });
    const res = await POST(makeRequest({ type: 'email', value: 'sharma@example.com', code: '654321' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe('/family');
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family-manager', fid: 'FAMNEW', mid: 'FAMNEW-01' }),
    );
  });

  it('legacy hit: migration succeeds but re-lookup misses → falls back to legacy claims', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ source: 'legacy', fid: null, mid: null, legacyFid: '42', family: {} })
      .mockResolvedValueOnce({ source: null, fid: null, mid: null, legacyFid: null, family: null });
    (lazyMigrateLegacyFamily as ReturnType<typeof vi.fn>).mockResolvedValue({ migrated: true, fid: 'FAMNEW', legacyFid: '42' });
    const res = await POST(makeRequest({ type: 'email', value: 'sharma@example.com', code: '654321' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe('/register?contact=verified');
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family', familyId: '42' }),
    );
  });

  it('correct code with no family redirects to /register', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: null, fid: null, mid: null, legacyFid: null, family: null,
    });
    const res = await POST(makeRequest({ type: 'email', value: 'new@example.com', code: '111111' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe('/register?contact=verified');
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('creates user if not found in Firebase Auth', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-01', legacyFid: null, family: {},
    });
    mockGetUser.mockRejectedValue({ code: 'auth/user-not-found' });
    mockCreateUser.mockResolvedValue({ uid: 'hash:raj@example.com' });
    const res = await POST(makeRequest({ type: 'email', value: 'raj@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    expect(mockCreateUser).toHaveBeenCalledWith({ uid: 'hash:raj@example.com', disabled: false });
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest({ type: 'email', value: 'raj@example.com', code: '123456' }));
    expect(res.status).toBe(404);
  });
});
