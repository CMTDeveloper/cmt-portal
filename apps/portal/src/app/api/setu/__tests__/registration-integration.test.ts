import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

// ── Feature flag ──────────────────────────────────────────────────────────────
const flagsMock = vi.hoisted(() => ({ setuAuth: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

// ── OTP helpers (family-lookup rate limiting) ─────────────────────────────────
vi.mock('@/features/check-in/shared', () => ({
  checkAndRecordOtpRateLimit: vi.fn(),
  normalizeContact: (t: string, v: string) =>
    t === 'email' ? v.trim().toLowerCase() : v.replace(/\D/g, ''),
  sha256Hex: (s: string) => `sha256:${s}`,
  storeVerificationCode: vi.fn(),
  verifyCode: vi.fn(),
}));

// ── register-family helper (used by /api/setu/register) ──────────────────────
vi.mock('@/features/setu/registration/register-family', () => ({
  registerFamily: vi.fn(),
}));

// ── hash-contact-key (used by family-lookup + family/join routes directly) ───
vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: (_type: string, value: string) => `hash:${value}`,
}));

// ── Firestore (family-lookup + family/join use it directly) ───────────────────
const mockFirestoreGet = vi.fn();
const mockFirestoreRunTransaction = vi.fn();
const mockCollectionGet = vi.fn();

const mockMembersCollection = {
  get: mockCollectionGet,
};

const makeDocRef = (overrides: Record<string, unknown> = {}) => ({
  get: mockFirestoreGet,
  collection: vi.fn().mockReturnValue({ ...mockMembersCollection, doc: vi.fn().mockReturnValue({ get: mockFirestoreGet, set: vi.fn() }) }),
  ...overrides,
});

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn().mockImplementation((_name: string) => ({
      doc: vi.fn().mockImplementation(() => makeDocRef()),
      get: mockCollectionGet,
    })),
    runTransaction: mockFirestoreRunTransaction,
  })),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TS') },
}));

// ── Firebase auth ─────────────────────────────────────────────────────────────
const mockAuth = {
  getUser: vi.fn(),
  createUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
  createCustomToken: vi.fn(),
};
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(() => mockAuth),
}));

vi.mock('@cmt/firebase-shared/admin/session', () => ({
  createPortalSessionCookie: vi.fn().mockResolvedValue('fake-session-cookie'),
  exchangeCustomTokenForIdToken: vi.fn().mockResolvedValue('fake-id-token'),
  verifyPortalSessionCookie: vi.fn(),
}));

import { checkAndRecordOtpRateLimit } from '@/features/check-in/shared';
import { registerFamily } from '@/features/setu/registration/register-family';
import { createPortalSessionCookie } from '@cmt/firebase-shared/admin/session';

import * as familyLookupHandler from '../family-lookup/route';
import * as registerHandler from '../register/route';
import * as familyJoinHandler from '../family/join/route';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const registerPayload = {
  email: 'raj@example.com',
  phone: '4165551234',
  familyName: 'Patel',
  location: 'Brampton' as const,
  manager: { firstName: 'Raj', lastName: 'Patel', gender: 'Male' as const },
  additionalMembers: [],
};

const registerResult = { fid: 'FAM001ABCD12', mid: 'FAM001ABCD12-01' };

function setupFirestoreForLookup(match: { fid: string; name: string; location: string; managerFirstName: string; managerLastName: string } | null) {
  if (!match) {
    // Neither email nor phone contactKey exists
    mockFirestoreGet.mockResolvedValue({ exists: false });
    return;
  }
  const contactKeyData = { contactKey: `hash:${match.fid}`, type: 'email', fid: match.fid, mid: `${match.fid}-01` };
  const familyData = { fid: match.fid, name: match.name, location: match.location, managers: [`${match.fid}-01`] };
  const memberData = { mid: `${match.fid}-01`, firstName: match.managerFirstName, lastName: match.managerLastName, manager: true };

  // email contactKey hit, phone contactKey miss
  mockFirestoreGet
    .mockResolvedValueOnce({ exists: true, data: () => contactKeyData }) // email contactKey
    .mockResolvedValueOnce({ exists: false })                             // phone contactKey
    .mockResolvedValueOnce({ exists: true, data: () => familyData });    // family doc

  // members collection get
  mockCollectionGet.mockResolvedValue({
    size: 1,
    docs: [{ data: () => memberData }],
  });
}

function setupTransactionForJoin(outcome: 'success' | 'contact-mismatch' | 'family-not-found') {
  if (outcome === 'contact-mismatch') {
    mockFirestoreRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        get: vi.fn().mockResolvedValue({ exists: false }),
        set: vi.fn(),
      };
      return fn(txn);
    });
    return;
  }
  if (outcome === 'family-not-found') {
    mockFirestoreRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      // contactKey fid matches the request fid so the fid check passes; family doc is missing
      const contactKeyDoc = { exists: true, data: () => ({ contactKey: 'hash:raj@example.com', type: 'email', fid: 'NONEXISTENT', mid: 'NONEXISTENT-01' }) };
      const familyDoc = { exists: false };
      const txn = {
        get: vi.fn()
          .mockResolvedValueOnce(contactKeyDoc)
          .mockResolvedValueOnce(familyDoc),
        set: vi.fn(),
      };
      return fn(txn);
    });
    return;
  }
  // success
  // contactKey points to an orphaned mid (the member doc never existed or was
  // deleted). joinFamily's idempotency guard checks for the existing member doc;
  // when that read returns { exists: false } it falls through to create a fresh
  // member. This models the original test intent: dedupe → join creates a new
  // family-member entry.
  const contactKeyDoc = { exists: true, data: () => ({ contactKey: 'hash:raj@example.com', type: 'email', fid: 'FAM001ABCD12', mid: 'FAM001ABCD12-99' }) };
  const familyDoc = { exists: true, data: () => ({ fid: 'FAM001ABCD12', name: 'Patel', managers: ['FAM001ABCD12-01'] }) };
  const existingMemberDoc = { exists: false };
  const membersSnap = { size: 1, docs: [] };
  mockFirestoreRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
    const txn = {
      get: vi.fn()
        .mockResolvedValueOnce(contactKeyDoc)
        .mockResolvedValueOnce(familyDoc)
        .mockResolvedValueOnce(existingMemberDoc)
        .mockResolvedValueOnce(membersSnap),
      set: vi.fn(),
    };
    return fn(txn);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuAuth = true;
  (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
  mockAuth.getUser.mockResolvedValue({ uid: 'uid-raj' });
  mockAuth.createUser.mockResolvedValue({ uid: 'uid-raj' });
  mockAuth.setCustomUserClaims.mockResolvedValue(undefined);
  mockAuth.createCustomToken.mockResolvedValue('fake-custom-token');
});

// ─────────────────────────────────────────────────────────────────────────────
// Full registration flow: lookup → no match → register
// ─────────────────────────────────────────────────────────────────────────────

describe('registration flow: new family (no match)', () => {
  it('family-lookup returns no match, then register creates family + sets session', async () => {
    setupFirestoreForLookup(null);
    (registerFamily as ReturnType<typeof vi.fn>).mockResolvedValue(registerResult);

    // Step 1: family-lookup returns no match
    await testApiHandler({
      appHandler: familyLookupHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
          body: JSON.stringify({ email: registerPayload.email, phone: registerPayload.phone }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.match).toBeNull();
      },
    });

    // Step 2: register
    await testApiHandler({
      appHandler: registerHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(registerPayload),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.fid).toBe('FAM001ABCD12');
        expect(body.mid).toBe('FAM001ABCD12-01');
        const setCookie = res.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain('__session');
      },
    });

    expect(registerFamily).toHaveBeenCalledOnce();
    expect(createPortalSessionCookie).toHaveBeenCalledOnce();
  });

  it('register sets family-manager role claims', async () => {
    (registerFamily as ReturnType<typeof vi.fn>).mockResolvedValue(registerResult);

    await testApiHandler({
      appHandler: registerHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(registerPayload),
        });
      },
    });

    expect(mockAuth.setCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        role: 'family-manager',
        fid: 'FAM001ABCD12',
        mid: 'FAM001ABCD12-01',
      }),
    );
  });

  it('register with additional child member passes through to registerFamily', async () => {
    (registerFamily as ReturnType<typeof vi.fn>).mockResolvedValue({
      fid: 'FAM002ABCD12',
      mid: 'FAM002ABCD12-01',
    });

    const payloadWithChild = {
      ...registerPayload,
      additionalMembers: [
        { firstName: 'Diya', lastName: 'Patel', type: 'Child', gender: 'Female', schoolGrade: 'Grade 5' },
      ],
    };

    await testApiHandler({
      appHandler: registerHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payloadWithChild),
        });
        expect(res.status).toBe(200);
      },
    });

    expect(registerFamily).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalMembers: expect.arrayContaining([
          expect.objectContaining({ firstName: 'Diya', type: 'Child' }),
        ]),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full dedupe flow: lookup → match found → join existing family
// ─────────────────────────────────────────────────────────────────────────────

describe('registration flow: existing family found (dedupe → join)', () => {
  it('family-lookup returns match, then family/join sets session with family-member role', async () => {
    setupFirestoreForLookup({ fid: 'FAM001ABCD12', name: 'Patel', location: 'Brampton', managerFirstName: 'Raj', managerLastName: 'Patel' });
    setupTransactionForJoin('success');

    // Step 1: family-lookup returns a match
    await testApiHandler({
      appHandler: familyLookupHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
          body: JSON.stringify({ email: 'raj@example.com', phone: '4165551234' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.match).not.toBeNull();
        expect(body.match.fid).toBe('FAM001ABCD12');
        expect(body.match.name).toBe('Patel');
      },
    });

    // Step 2: user chooses to join — new member gets family-member role (not in managers list)
    await testApiHandler({
      appHandler: familyJoinHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fid: 'FAM001ABCD12',
            contactProof: { type: 'email', value: 'raj@example.com' },
          }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.fid).toBe('FAM001ABCD12');
        const setCookie = res.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain('__session');
      },
    });

    expect(createPortalSessionCookie).toHaveBeenCalledOnce();
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('family/join sets family-member role when new member is not in managers list', async () => {
    setupTransactionForJoin('success');

    await testApiHandler({
      appHandler: familyJoinHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fid: 'FAM001ABCD12',
            contactProof: { type: 'email', value: 'raj@example.com' },
          }),
        });
      },
    });

    expect(mockAuth.setCustomUserClaims).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'family-member', fid: 'FAM001ABCD12' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate contact race: register called twice with same email
// ─────────────────────────────────────────────────────────────────────────────

describe('race condition: duplicate register', () => {
  it('first register succeeds; second returns 409 duplicate-contact', async () => {
    let callCount = 0;
    (registerFamily as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return registerResult;
      throw Object.assign(new Error('Contact already registered'), { code: 'duplicate-contact' });
    });

    const statuses: number[] = [];

    await Promise.all([
      testApiHandler({
        appHandler: registerHandler,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(registerPayload),
          });
          statuses.push(res.status);
        },
      }),
      testApiHandler({
        appHandler: registerHandler,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(registerPayload),
          });
          statuses.push(res.status);
        },
      }),
    ]);

    expect(statuses).toContain(200);
    expect(statuses).toContain(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// family-lookup: rate limiting
// ─────────────────────────────────────────────────────────────────────────────

describe('family-lookup: rate limiting', () => {
  it('returns 429 with resetAt when rate limited', async () => {
    const resetAt = new Date(Date.now() + 60_000).toISOString();
    (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({
      allowed: false,
      resetAt,
    });

    await testApiHandler({
      appHandler: familyLookupHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
          body: JSON.stringify({ email: 'raj@example.com', phone: '4165551234' }),
        });
        expect(res.status).toBe(429);
        const body = await res.json();
        expect(body.resetAt).toBe(resetAt);
      },
    });
  });

  it('Firestore not queried when rate limited (no family enumeration)', async () => {
    (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({
      allowed: false,
      resetAt: new Date().toISOString(),
    });

    await testApiHandler({
      appHandler: familyLookupHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
          body: JSON.stringify({ email: 'raj@example.com', phone: '4165551234' }),
        });
      },
    });

    expect(mockFirestoreGet).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// family/join: contact proof errors
// ─────────────────────────────────────────────────────────────────────────────

describe('family/join: contact proof mismatch', () => {
  it('returns 403 when contact does not match the family', async () => {
    setupTransactionForJoin('contact-mismatch');

    await testApiHandler({
      appHandler: familyJoinHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fid: 'FAM001ABCD12',
            contactProof: { type: 'email', value: 'imposter@example.com' },
          }),
        });
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe('contact-mismatch');
      },
    });
  });

  it('returns 404 when target family does not exist', async () => {
    setupTransactionForJoin('family-not-found');

    await testApiHandler({
      appHandler: familyJoinHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fid: 'NONEXISTENT',
            contactProof: { type: 'email', value: 'raj@example.com' },
          }),
        });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('family-not-found');
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Firebase user provisioning
// ─────────────────────────────────────────────────────────────────────────────

describe('Firebase user provisioning', () => {
  it('register: creates Firebase user when auth/user-not-found', async () => {
    (registerFamily as ReturnType<typeof vi.fn>).mockResolvedValue(registerResult);
    mockAuth.getUser.mockRejectedValue({ code: 'auth/user-not-found' });
    mockAuth.createUser.mockResolvedValue({ uid: 'uid-new-manager' });

    await testApiHandler({
      appHandler: registerHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(registerPayload),
        });
        expect(res.status).toBe(200);
      },
    });

    expect(mockAuth.createUser).toHaveBeenCalledOnce();
  });

  it('family/join: creates Firebase user when auth/user-not-found', async () => {
    setupTransactionForJoin('success');
    mockAuth.getUser.mockRejectedValue({ code: 'auth/user-not-found' });
    mockAuth.createUser.mockResolvedValue({ uid: 'uid-new-member' });

    await testApiHandler({
      appHandler: familyJoinHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fid: 'FAM001ABCD12',
            contactProof: { type: 'email', value: 'priya@example.com' },
          }),
        });
        expect(res.status).toBe(200);
      },
    });

    expect(mockAuth.createUser).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature flag off: all three endpoints return 404
// ─────────────────────────────────────────────────────────────────────────────

describe('feature flag off: all registration endpoints return 404', () => {
  it('family-lookup returns 404', async () => {
    flagsMock.setuAuth = false;
    await testApiHandler({
      appHandler: familyLookupHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
          body: JSON.stringify({ email: 'raj@example.com', phone: '4165551234' }),
        });
        expect(res.status).toBe(404);
      },
    });
    expect(mockFirestoreGet).not.toHaveBeenCalled();
  });

  it('register returns 404', async () => {
    flagsMock.setuAuth = false;
    await testApiHandler({
      appHandler: registerHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(registerPayload),
        });
        expect(res.status).toBe(404);
      },
    });
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('family/join returns 404', async () => {
    flagsMock.setuAuth = false;
    await testApiHandler({
      appHandler: familyJoinHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fid: 'FAM001ABCD12',
            contactProof: { type: 'email', value: 'raj@example.com' },
          }),
        });
        expect(res.status).toBe(404);
      },
    });
    expect(mockFirestoreRunTransaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schema validation
// ─────────────────────────────────────────────────────────────────────────────

describe('family-lookup: schema validation', () => {
  it('returns 400 when email is missing', async () => {
    await testApiHandler({
      appHandler: familyLookupHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
          body: JSON.stringify({ phone: '4165551234' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 when phone is missing', async () => {
    await testApiHandler({
      appHandler: familyLookupHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
          body: JSON.stringify({ email: 'raj@example.com' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 when email format is invalid', async () => {
    await testApiHandler({
      appHandler: familyLookupHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
          body: JSON.stringify({ email: 'not-an-email', phone: '4165551234' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });
});

describe('register: schema validation', () => {
  it('returns 400 on missing familyName', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { familyName, ...rest } = registerPayload;
    await testApiHandler({
      appHandler: registerHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(rest),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 on invalid location', async () => {
    await testApiHandler({
      appHandler: registerHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...registerPayload, location: 'Toronto' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 on missing manager.firstName', async () => {
    await testApiHandler({
      appHandler: registerHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...registerPayload,
            manager: { lastName: 'Patel', gender: 'Male' },
          }),
        });
        expect(res.status).toBe(400);
      },
    });
  });
});

describe('family/join: schema validation', () => {
  it('returns 400 on missing fid', async () => {
    await testApiHandler({
      appHandler: familyJoinHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contactProof: { type: 'email', value: 'raj@example.com' } }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 on missing contactProof', async () => {
    await testApiHandler({
      appHandler: familyJoinHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fid: 'FAM001ABCD12' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 on invalid contactProof type', async () => {
    await testApiHandler({
      appHandler: familyJoinHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fid: 'FAM001ABCD12', contactProof: { type: 'sms', value: 'raj@example.com' } }),
        });
        expect(res.status).toBe(400);
      },
    });
  });
});
