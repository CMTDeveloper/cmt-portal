import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/setu/registration/register-family', () => ({
  registerFamily: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  createPortalSessionCookie: vi.fn(),
  exchangeCustomTokenForIdToken: vi.fn(),
}));

import { POST } from '../route';
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

  it('returns 409 when duplicate contact key exists', async () => {
    (registerFamily as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('duplicate-contact'), { code: 'duplicate-contact' }),
    );
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('duplicate-contact');
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
