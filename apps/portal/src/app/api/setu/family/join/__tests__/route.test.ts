import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/setu/registration/family-join', () => ({
  joinFamily: vi.fn(),
}));
vi.mock('@/features/check-in/shared', () => ({
  normalizeContact: vi.fn((type: string, value: string) =>
    type === 'email' ? value.toLowerCase().trim() : value.replace(/\D/g, ''),
  ),
  sha256Hex: vi.fn((s: string) => `hash:${s}`),
}));
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  createPortalSessionCookie: vi.fn(),
  exchangeCustomTokenForIdToken: vi.fn(),
}));

import { POST } from '../route';
import { joinFamily } from '@/features/setu/registration/family-join';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';

const mockGetUser = vi.fn();
const mockCreateUser = vi.fn();
const mockSetCustomUserClaims = vi.fn();
const mockCreateCustomToken = vi.fn();

const validBody = {
  fid: 'FAM001ABCD12',
  contactProof: { type: 'email', value: 'raj@example.com' },
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/setu/family/join', {
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
  mockGetUser.mockResolvedValue({ uid: 'uid-raj' });
  mockSetCustomUserClaims.mockResolvedValue(undefined);
  mockCreateCustomToken.mockResolvedValue('custom-token');
  (exchangeCustomTokenForIdToken as ReturnType<typeof vi.fn>).mockResolvedValue('id-token');
  (createPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValue('session-cookie');
});

describe('POST /api/setu/family/join', () => {
  it('returns 400 on missing fid', async () => {
    const res = await POST(makeRequest({ contactProof: { type: 'email', value: 'raj@example.com' } }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on missing contactProof', async () => {
    const res = await POST(makeRequest({ fid: 'FAM001ABCD12' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid contactProof type', async () => {
    const res = await POST(makeRequest({ fid: 'FAM001ABCD12', contactProof: { type: 'sms', value: 'raj@example.com' } }));
    expect(res.status).toBe(400);
  });

  it('returns 403 when joinFamily throws contact-not-found error', async () => {
    (joinFamily as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Contact not found: no matching contact key'),
    );
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('contact-mismatch');
  });

  it('returns 403 when joinFamily throws contact does not belong error', async () => {
    (joinFamily as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Contact does not belong to the specified family'),
    );
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('contact-mismatch');
  });

  it('happy path: joins family, sets session cookie, returns fid + mid', async () => {
    (joinFamily as ReturnType<typeof vi.fn>).mockResolvedValue({
      fid: 'FAM001ABCD12',
      mid: 'FAM001ABCD12-02',
      isManager: false,
    });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fid).toBe('FAM001ABCD12');
    expect(body.mid).toBe('FAM001ABCD12-02');
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('__session');
  });

  it('sets family-member role claims when joining as non-manager', async () => {
    (joinFamily as ReturnType<typeof vi.fn>).mockResolvedValue({
      fid: 'FAM001ABCD12',
      mid: 'FAM001ABCD12-02',
      isManager: false,
    });

    await POST(makeRequest(validBody));
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family-member', fid: 'FAM001ABCD12', mid: 'FAM001ABCD12-02' }),
    );
  });

  it('sets family-manager role claims when joining as manager', async () => {
    (joinFamily as ReturnType<typeof vi.fn>).mockResolvedValue({
      fid: 'FAM001ABCD12',
      mid: 'FAM001ABCD12-01',
      isManager: true,
    });

    await POST(makeRequest(validBody));
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family-manager', fid: 'FAM001ABCD12', mid: 'FAM001ABCD12-01' }),
    );
  });

  it('creates Firebase user if not found', async () => {
    (joinFamily as ReturnType<typeof vi.fn>).mockResolvedValue({
      fid: 'FAM001ABCD12',
      mid: 'FAM001ABCD12-02',
      isManager: false,
    });
    mockGetUser.mockRejectedValue({ code: 'auth/user-not-found' });
    mockCreateUser.mockResolvedValue({ uid: 'uid-new' });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    expect(mockCreateUser).toHaveBeenCalledWith({ uid: expect.any(String), disabled: false });
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest(validBody));
    expect(res.status).toBe(404);
  });
});
