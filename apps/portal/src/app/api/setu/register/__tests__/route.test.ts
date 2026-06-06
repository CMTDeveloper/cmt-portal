import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/setu/registration/register-family', () => ({
  registerFamily: vi.fn(),
}));
// Preserve the real contact helpers the route also pulls from this barrel
// (sha256Hex, normalizeContact) while overriding the rate-limit surface.
vi.mock('@/features/check-in/shared', async (importActual) => {
  const actual = await importActual<typeof import('@/features/check-in/shared')>();
  return {
    ...actual,
    checkAndRecordOtpRateLimit: vi.fn(),
    REGISTER_RATE_LIMIT_MAX: 10,
  };
});
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  createPortalSessionCookie: vi.fn(),
  exchangeCustomTokenForIdToken: vi.fn(),
}));

import { POST } from '../route';
import { checkAndRecordOtpRateLimit } from '@/features/check-in/shared';
import { registerFamily } from '@/features/setu/registration/register-family';
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
  email: 'raj@example.com',
  phone: '4165551234',
  familyName: 'Patel',
  location: 'Brampton',
  manager: { firstName: 'Raj', lastName: 'Patel', gender: 'Male' },
  additionalMembers: [],
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/setu/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
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
  (registerFamily as ReturnType<typeof vi.fn>).mockResolvedValue({
    fid: 'FAM001ABCD12',
    mid: 'FAM001ABCD12-01',
  });
});

describe('POST /api/setu/register', () => {
  it('returns 400 on missing email', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { email, ...rest } = validBody;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
  });

  it('returns 400 on missing phone', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { phone, ...rest } = validBody;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
  });

  it('returns 400 on missing familyName', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { familyName, ...rest } = validBody;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid location', async () => {
    const res = await POST(makeRequest({ ...validBody, location: 'Toronto' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on missing manager firstName', async () => {
    const res = await POST(makeRequest({
      ...validBody,
      manager: { lastName: 'Patel', gender: 'Male' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 429 when the per-IP register rate limit is exceeded — and does NOT call registerFamily', async () => {
    (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({
      allowed: false,
      resetAt: '2026-06-05T12:00:00.000Z',
    });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('rate-limited');
    expect(body.resetAt).toBe('2026-06-05T12:00:00.000Z');
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('rate-limits by IP with the stricter REGISTER_RATE_LIMIT_MAX (write quota)', async () => {
    await POST(new Request('http://localhost/api/setu/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
      body: JSON.stringify(validBody),
    }));
    expect(checkAndRecordOtpRateLimit).toHaveBeenCalledWith('register:9.9.9.9', 10);
  });

  it('a malformed body 400s BEFORE consuming rate-limit quota', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { email, ...rest } = validBody;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
    expect(checkAndRecordOtpRateLimit).not.toHaveBeenCalled();
  });

  it('returns 409 when duplicate contact key exists', async () => {
    (registerFamily as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('duplicate-contact'), { code: 'duplicate-contact' }),
    );
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('duplicate-contact');
  });

  it('maps a pre-existing-family throw to the generic error WITHOUT leaking the message (enumeration)', async () => {
    (registerFamily as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Contact already registered: manager email is linked to an existing family'),
    );
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('duplicate-contact');
    // The raw message must NOT be surfaced — it would reveal a contact belongs to SOME family.
    expect(body.message).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('existing family');
  });

  it('returns 409 with the distinct code when registerFamily throws duplicate-contact-in-form', async () => {
    (registerFamily as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('duplicate-contact-in-form'),
    );
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('duplicate-contact-in-form');
  });

  it('happy path: creates family, sets cookie, returns fid + mid', async () => {
    mockGetUser.mockRejectedValue({ code: 'auth/user-not-found' });
    mockCreateUser.mockResolvedValue({ uid: 'uid-raj' });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fid).toBe('FAM001ABCD12');
    expect(body.mid).toBe('FAM001ABCD12-01');
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('__session');
  });

  it('sets family-manager role claims on session cookie', async () => {
    await POST(makeRequest(validBody));
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family-manager', fid: 'FAM001ABCD12', mid: 'FAM001ABCD12-01' }),
    );
  });

  it('passes additional members through to registerFamily', async () => {
    const bodyWithKids = {
      ...validBody,
      additionalMembers: [
        { firstName: 'Diya', lastName: 'Patel', type: 'Child', gender: 'Female', schoolGrade: 'Grade 5' },
      ],
    };
    await POST(makeRequest(bodyWithKids));
    expect(registerFamily).toHaveBeenCalledWith(expect.objectContaining({
      additionalMembers: expect.arrayContaining([
        expect.objectContaining({ firstName: 'Diya', type: 'Child' }),
      ]),
    }));
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest(validBody));
    expect(res.status).toBe(404);
  });
});
