import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/setu/registration/register-family', () => ({
  registerFamily: vi.fn(),
}));
vi.mock('@/features/setu/registration/registration-grant', () => ({
  consumeRegistrationGrant: vi.fn(),
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
// The route now validates `location` against the admin-managed centre list.
// Mock it to a fixed two-centre set so tests are independent of Firestore.
vi.mock('@/lib/locations', () => ({
  getLocationOptions: vi.fn().mockResolvedValue(['Brampton', 'Scarborough']),
}));

import { POST } from '../route';
import { checkAndRecordOtpRateLimit } from '@/features/check-in/shared';
import { registerFamily } from '@/features/setu/registration/register-family';
import { consumeRegistrationGrant } from '@/features/setu/registration/registration-grant';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';

const mockGetUser = vi.fn();
const mockCreateUser = vi.fn();
const mockSetCustomUserClaims = vi.fn();
const mockCreateCustomToken = vi.fn();

// Gate-complete manager: Adult required matrix = gender + foodAllergies +
// >=1 volunteering skill (email/phone arrive at the top level). Anything less
// now trips the per-type 400 guard before registerFamily is reached.
const validBody = {
  email: 'raj@example.com',
  phone: '4165551234',
  familyName: 'Patel',
  location: 'Brampton',
  familyAddress: {
    street: '123 Main St',
    unit: '',
    city: 'Brampton',
    province: 'ON',
    postalCode: 'L6T 1A1',
  },
  manager: {
    firstName: 'Raj',
    lastName: 'Patel',
    gender: 'Male',
    foodAllergies: 'None',
    volunteeringSkills: ['Setup'],
  },
  additionalMembers: [],
  registrationGrant: 'grant-token-abc',
};

// A gate-complete child member (schoolGrade + birthMonthYear + foodAllergies).
const completeChild = {
  firstName: 'Diya',
  lastName: 'Patel',
  type: 'Child',
  gender: 'Female',
  foodAllergies: 'Peanuts',
  schoolGrade: 'Grade 5',
  birthMonthYear: '2016-03',
};

// A gate-complete adult member reusing the manager's contact (allowed).
const completeAdultReusingManagerContact = {
  firstName: 'Priya',
  lastName: 'Patel',
  type: 'Adult',
  gender: 'Female',
  foodAllergies: 'None',
  volunteeringSkills: ['Kitchen'],
  email: validBody.email, // same as manager — must be accepted
  phone: validBody.phone, // same as manager — must be accepted
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
  // Default: a valid, matching registration grant (email was OTP-verified).
  (consumeRegistrationGrant as ReturnType<typeof vi.fn>).mockResolvedValue(true);
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

  it('rejects a location that is not a configured centre', async () => {
    const res = await POST(makeRequest({ ...validBody, location: 'Nowhere' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid-location' });
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('accepts a configured centre', async () => {
    const res = await POST(makeRequest({ ...validBody, location: 'Scarborough' }));
    expect(res.status).not.toBe(400);
  });

  it('returns 400 when familyAddress is missing (address is required)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { familyAddress, ...rest } = validBody;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('returns 400 when familyAddress has an invalid postal code', async () => {
    const res = await POST(makeRequest({
      ...validBody,
      familyAddress: { ...validBody.familyAddress, postalCode: '12345' },
    }));
    expect(res.status).toBe(400);
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('forwards familyAddress through to registerFamily', async () => {
    await POST(makeRequest(validBody));
    expect(registerFamily).toHaveBeenCalledWith(expect.objectContaining({
      familyAddress: expect.objectContaining({
        street: '123 Main St',
        city: 'Brampton',
        province: 'ON',
        postalCode: 'L6T 1A1',
      }),
    }));
  });

  it('returns 400 on missing manager firstName', async () => {
    const res = await POST(makeRequest({
      ...validBody,
      manager: { lastName: 'Patel', gender: 'Male' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the registrationGrant is missing (ownership proof required)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { registrationGrant, ...rest } = validBody;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('returns 403 and creates NOTHING when the grant is invalid/expired/mismatched', async () => {
    (consumeRegistrationGrant as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('registration-unverified');
    expect(registerFamily).not.toHaveBeenCalled();
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('consumes the grant against the submitted email before any write', async () => {
    await POST(makeRequest(validBody));
    expect(consumeRegistrationGrant).toHaveBeenCalledWith('grant-token-abc', 'raj@example.com');
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
      additionalMembers: [completeChild],
    };
    await POST(makeRequest(bodyWithKids));
    expect(registerFamily).toHaveBeenCalledWith(expect.objectContaining({
      additionalMembers: expect.arrayContaining([
        expect.objectContaining({ firstName: 'Diya', type: 'Child' }),
      ]),
    }));
  });

  it('forwards the manager foodAllergies + volunteeringSkills to registerFamily', async () => {
    await POST(makeRequest(validBody));
    expect(registerFamily).toHaveBeenCalledWith(expect.objectContaining({
      manager: expect.objectContaining({
        firstName: 'Raj',
        foodAllergies: 'None',
        volunteeringSkills: ['Setup'],
      }),
    }));
  });

  it('forwards a child member schoolGrade + birthMonthYear + foodAllergies', async () => {
    await POST(makeRequest({ ...validBody, additionalMembers: [completeChild] }));
    expect(registerFamily).toHaveBeenCalledWith(expect.objectContaining({
      additionalMembers: expect.arrayContaining([
        expect.objectContaining({
          schoolGrade: 'Grade 5',
          birthMonthYear: '2016-03',
          foodAllergies: 'Peanuts',
        }),
      ]),
    }));
  });
});

describe('POST /api/setu/register — gender enum tightened to Male|Female', () => {
  it('rejects manager gender PreferNotToSay (capture forms must yield a real pick)', async () => {
    const res = await POST(makeRequest({
      ...validBody,
      manager: { ...validBody.manager, gender: 'PreferNotToSay' },
    }));
    expect(res.status).toBe(400);
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('rejects an additional member gender PreferNotToSay', async () => {
    const res = await POST(makeRequest({
      ...validBody,
      additionalMembers: [{ ...completeChild, gender: 'PreferNotToSay' }],
    }));
    expect(res.status).toBe(400);
    expect(registerFamily).not.toHaveBeenCalled();
  });
});

describe('POST /api/setu/register — per-type required matrix (400 guards)', () => {
  it('400 foodAllergies-required when the manager omits foodAllergies', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { foodAllergies, ...managerNoAllergies } = validBody.manager;
    const res = await POST(makeRequest({ ...validBody, manager: managerNoAllergies }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('foodAllergies-required');
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('400 skills-required when the manager has zero volunteering skills', async () => {
    const res = await POST(makeRequest({
      ...validBody,
      manager: { ...validBody.manager, volunteeringSkills: [] },
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('skills-required');
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('400 grade-required when a child member omits schoolGrade', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { schoolGrade, ...childNoGrade } = completeChild;
    const res = await POST(makeRequest({ ...validBody, additionalMembers: [childNoGrade] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('grade-required');
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('400 birthmonth-required when a child member omits birthMonthYear', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { birthMonthYear, ...childNoBirth } = completeChild;
    const res = await POST(makeRequest({ ...validBody, additionalMembers: [childNoBirth] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('birthmonth-required');
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('400 contact-required when an adult member omits email + phone', async () => {
    const res = await POST(makeRequest({
      ...validBody,
      additionalMembers: [{
        firstName: 'Arjun', lastName: 'Patel', type: 'Adult', gender: 'Male',
        foodAllergies: 'None', volunteeringSkills: ['Setup'],
        // no email / no phone
      }],
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('contact-required');
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('accepts an adult member that REUSES the manager email + phone (same-family reuse passes)', async () => {
    const res = await POST(makeRequest({
      ...validBody,
      additionalMembers: [completeAdultReusingManagerContact],
    }));
    expect(res.status).toBe(200);
    expect(registerFamily).toHaveBeenCalledWith(expect.objectContaining({
      additionalMembers: expect.arrayContaining([
        expect.objectContaining({
          firstName: 'Priya',
          email: validBody.email,
          phone: validBody.phone,
        }),
      ]),
    }));
  });

  it('happy path: complete adult-manager + complete child registers (200)', async () => {
    const res = await POST(makeRequest({
      ...validBody,
      additionalMembers: [completeChild],
    }));
    expect(res.status).toBe(200);
    expect(registerFamily).toHaveBeenCalledOnce();
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest(validBody));
    expect(res.status).toBe(404);
  });
});
