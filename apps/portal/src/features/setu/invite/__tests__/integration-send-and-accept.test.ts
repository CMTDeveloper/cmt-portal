import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Feature flag ──────────────────────────────────────────────────────────────
const flagsMock = vi.hoisted(() => ({ setuAuth: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

// ── next/headers ──────────────────────────────────────────────────────────────
const mockCookiesGet = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: mockCookiesGet }),
  headers: vi.fn(() => new Headers()),
}));

// ── resolveSender — no real SES/SNS ──────────────────────────────────────────
const mockSendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/aws/resolve-sender', () => ({
  resolveSender: () => ({ sendEmail: mockSendEmail, sendSMS: vi.fn() }),
}));

// ── portalEnv ─────────────────────────────────────────────────────────────────
vi.mock('@/lib/env', () => ({
  portalEnv: vi.fn(() => ({
    SETU_INVITE_TTL_DAYS: 14,
    NEXT_PUBLIC_PORTAL_BASE_URL: 'https://portal.example.org',
  })),
}));

// ── hash-contact-key ──────────────────────────────────────────────────────────
vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: (_type: string, value: string) => `hash:${value}`,
}));

// ── getInviteByToken — used by GET /api/setu/invite/[token] ──────────────────
const mockGetInviteByToken = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/invite/get-invite', () => ({
  getInviteByToken: mockGetInviteByToken,
}));

// ── getCurrentSessionContact — used by POST /api/setu/invite/accept ──────────
const mockGetCurrentSessionContact = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/auth/get-current-session-email', () => ({
  getCurrentSessionContact: mockGetCurrentSessionContact,
}));

// ── Firestore ─────────────────────────────────────────────────────────────────
const mockFirestoreGet = vi.hoisted(() => vi.fn());
const mockFirestoreSet = vi.hoisted(() => vi.fn());
const mockFirestoreDelete = vi.hoisted(() => vi.fn());
const mockFirestoreUpdate = vi.hoisted(() => vi.fn());
const mockCollectionGet = vi.hoisted(() => vi.fn());
const mockRunTransaction = vi.hoisted(() => vi.fn());
const mockCollectionGroupGet = vi.hoisted(() => vi.fn());

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn().mockImplementation((_name: string) => ({
      doc: vi.fn().mockImplementation((_id?: string) => ({
        id: _id ?? 'auto-id',
        get: mockFirestoreGet,
        set: mockFirestoreSet,
        delete: mockFirestoreDelete,
        update: mockFirestoreUpdate,
        collection: vi.fn().mockImplementation((_sub: string) => ({
          doc: vi.fn().mockImplementation((_sid?: string) => ({
            id: _sid ?? 'sub-auto-id',
            get: mockFirestoreGet,
            set: mockFirestoreSet,
            delete: mockFirestoreDelete,
            update: mockFirestoreUpdate,
          })),
          get: mockCollectionGet,
          orderBy: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
        })),
      })),
      get: mockCollectionGet,
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
    })),
    collectionGroup: vi.fn().mockImplementation((_name: string) => ({
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: mockCollectionGroupGet,
    })),
    runTransaction: mockRunTransaction,
  })),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    arrayUnion: vi.fn((...args: string[]) => ({ _union: args })),
    arrayRemove: vi.fn((...args: string[]) => ({ _remove: args })),
  },
  Timestamp: {
    fromDate: vi.fn((d: Date) => ({ _seconds: Math.floor(d.getTime() / 1000), toDate: () => d })),
  },
}));

// ── Firebase auth ─────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => ({
  getUser: vi.fn(),
  createUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
  createCustomToken: vi.fn().mockResolvedValue('fake-custom-token'),
}));
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(() => mockAuth),
}));

// ── Session ───────────────────────────────────────────────────────────────────
const mockVerifySession = vi.hoisted(() => vi.fn());
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  verifyPortalSessionCookie: mockVerifySession,
  createPortalSessionCookie: vi.fn().mockResolvedValue('fake-session-cookie'),
  exchangeCustomTokenForIdToken: vi.fn().mockResolvedValue('fake-id-token'),
}));

// ── Route handlers (populated by workers 1 + 2) ───────────────────────────────
import { POST as sendPOST } from '../../../../app/api/setu/invite/send/route';
import { GET as tokenGET } from '../../../../app/api/setu/invite/[token]/route';
import { POST as acceptPOST } from '../../../../app/api/setu/invite/accept/route';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FID = 'FAMA0001ABCD';
const MANAGER_MID = 'FAMA0001ABCD-01';
const FAMILY_DOC = {
  fid: FID,
  name: 'Sharma Family',
  location: 'Brampton',
  managers: [MANAGER_MID],
};
const MANAGER_DOC = {
  mid: MANAGER_MID,
  firstName: 'Raj',
  lastName: 'Sharma',
  displayName: 'Raj Sharma',
  manager: true,
  email: 'raj@example.com',
};

const INVITE_EMAIL = 'bob@example.com';
const INVITE_RELATION = 'Spouse';

// ── Request helpers ───────────────────────────────────────────────────────────

function makeRequest(
  method: string,
  pathname: string,
  body: unknown = null,
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', ...extraHeaders },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
}

function managerHeaders(fid = FID, mid = MANAGER_MID): Record<string, string> {
  return {
    'x-portal-role': 'family-manager',
    'x-portal-fid': fid,
    'x-portal-mid': mid,
    'x-portal-uid': `uid-${mid}`,
  };
}

function memberHeaders(fid = FID, mid = MANAGER_MID): Record<string, string> {
  return {
    'x-portal-role': 'family-member',
    'x-portal-fid': fid,
    'x-portal-mid': mid,
    'x-portal-uid': `uid-${mid}`,
  };
}

function sessionAs(email: string, uid = 'uid-bob') {
  mockGetCurrentSessionContact.mockResolvedValue({ type: 'email' as const, value: email, uid });
}

// ── Invite doc builders ───────────────────────────────────────────────────────

function makeInviteDoc(overrides: {
  email?: string;
  relation?: string;
  inviterMid?: string;
  inviterName?: string;
  familyName?: string;
  createdAt?: unknown;
  expiresAt?: unknown;
  acceptedAt?: null | unknown;
  token?: string;
} = {}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 14 * 86400_000);
  return {
    email: INVITE_EMAIL,
    relation: INVITE_RELATION,
    inviterMid: MANAGER_MID,
    inviterName: 'Raj Sharma',
    familyName: 'Sharma Family',
    fid: FID,
    createdAt: 'SERVER_TS',
    expiresAt: { _seconds: Math.floor(expiresAt.getTime() / 1000), toDate: () => expiresAt },
    acceptedAt: null,
    token: 'validtoken123abc',
    ...overrides,
  };
}

// ── Transaction setup for send ────────────────────────────────────────────────

function setupSendTransaction() {
  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
    const txn = {
      get: vi.fn()
        .mockResolvedValueOnce({ exists: true, data: () => FAMILY_DOC })
        .mockResolvedValueOnce({ exists: true, data: () => MANAGER_DOC }),
      set: mockFirestoreSet,
    };
    return fn(txn);
  });
}

// ── Transaction setup for accept ─────────────────────────────────────────────

function setupAcceptTransaction(opts: {
  contactKeyExists?: boolean;
  contactKeyFid?: string;
  memberCount?: number;
  inviteData?: ReturnType<typeof makeInviteDoc>;
} = {}) {
  const { contactKeyExists = false, contactKeyFid = FID, memberCount = 1, inviteData = makeInviteDoc() } = opts;
  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
    const txn = {
      get: vi.fn()
        // 1. txn.get(inviteDoc.ref) — invite snap re-read inside transaction
        .mockResolvedValueOnce({ exists: true, data: () => inviteData })
        // 2. txn.get(familyRef)
        .mockResolvedValueOnce({ exists: true, data: () => FAMILY_DOC })
        // 3. txn.get(membersCollection) — size
        .mockResolvedValueOnce({ size: memberCount, docs: [] })
        // 4. txn.get(contactKeyRef)
        .mockResolvedValueOnce({
          exists: contactKeyExists,
          data: () => contactKeyExists ? { fid: contactKeyFid, mid: `${contactKeyFid}-99` } : undefined,
        }),
      set: mockFirestoreSet,
      update: mockFirestoreUpdate,
    };
    return fn(txn);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuAuth = true;
  mockGetCurrentSessionContact.mockResolvedValue(null);
  mockAuth.getUser.mockResolvedValue({ uid: 'uid-bob' });
  mockAuth.createUser.mockResolvedValue({ uid: 'uid-bob' });
  mockAuth.setCustomUserClaims.mockResolvedValue(undefined);
  mockAuth.createCustomToken.mockResolvedValue('fake-custom-token');
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: Happy path — send → GET → accept
// ─────────────────────────────────────────────────────────────────────────────

describe('happy path: send → GET invite → accept', () => {
  it('send returns 201 with a base64url token and calls sendEmail', async () => {
    setupSendTransaction();

    const res = await sendPOST(
      makeRequest('POST', '/api/setu/invite/send', { email: INVITE_EMAIL, relation: INVITE_RELATION }, managerHeaders()),
    );

    expect(res.status).toBe(201);
    const body = await res.json() as { token: string };
    expect(body.token).toBeDefined();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(body.token.length).toBeGreaterThanOrEqual(32);
    expect(mockSendEmail).toHaveBeenCalledOnce();
    const emailCall = mockSendEmail.mock.calls[0]![0]! as { to: string; subject: string; text: string };
    expect(emailCall.to).toBe(INVITE_EMAIL);
    expect(emailCall.subject).toContain('Raj Sharma');
    expect(emailCall.text).toContain('/invite/');
  });

  it('invite doc is written with correct shape (email, relation, inviterMid, acceptedAt:null)', async () => {
    setupSendTransaction();

    await sendPOST(
      makeRequest('POST', '/api/setu/invite/send', { email: INVITE_EMAIL, relation: INVITE_RELATION }, managerHeaders()),
    );

    expect(mockFirestoreSet).toHaveBeenCalledOnce();
    const doc = mockFirestoreSet.mock.calls[0]![1]! as Record<string, unknown>;
    expect(doc.email).toBe(INVITE_EMAIL);
    expect(doc.relation).toBe(INVITE_RELATION);
    expect(doc.inviterMid).toBe(MANAGER_MID);
    expect(doc.acceptedAt).toBeNull();
    expect(doc.token).toBeDefined();
  });

  it('GET /api/setu/invite/[token] returns familyName + inviterName + relation for valid token', async () => {
    const future = new Date(Date.now() + 10 * 86400_000);
    mockGetInviteByToken.mockResolvedValueOnce({
      token: 'validtoken123abc',
      fid: FID,
      email: INVITE_EMAIL,
      relation: INVITE_RELATION,
      inviterMid: MANAGER_MID,
      inviterName: 'Raj Sharma',
      familyName: 'Sharma Family',
      expiresAt: future,
      acceptedAt: null,
      acceptedByMid: null,
    });

    const token = 'validtoken123abc';
    const res = await tokenGET(
      makeRequest('GET', `/api/setu/invite/${token}`),
      { params: Promise.resolve({ token }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { familyName: string; inviterName: string; relation: string; expiresAt: string };
    expect(body.familyName).toBe('Sharma Family');
    expect(body.inviterName).toBe('Raj Sharma');
    expect(body.relation).toBe(INVITE_RELATION);
    expect(body.expiresAt).toBeDefined();
    expect(mockGetInviteByToken).toHaveBeenCalledWith('validtoken123abc');
  });

  it('accept POST creates member, writes contactKey, marks acceptedAt', async () => {
    const token = 'validtoken123abc';
    const inviteDoc = makeInviteDoc({ token });
    const fakeRef = { parent: { parent: { id: FID } } };
    mockCollectionGroupGet.mockResolvedValueOnce({ empty: false, docs: [{ data: () => inviteDoc, ref: fakeRef }] });
    sessionAs(INVITE_EMAIL);
    setupAcceptTransaction({ contactKeyExists: false, memberCount: 1, inviteData: inviteDoc });

    const res = await acceptPOST(
      makeRequest('POST', '/api/setu/invite/accept', { token }),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { fid: string; mid: string };
    expect(body.fid).toBe(FID);
    expect(body.mid).toBeDefined();
    expect(body.mid).toMatch(new RegExp(`^${FID}-`));
    expect(mockRunTransaction).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Expired invite → GET 410, accept 410
// ─────────────────────────────────────────────────────────────────────────────

describe('edge: expired invite', () => {
  it('GET returns 410 when invite is past expiresAt', async () => {
    mockGetInviteByToken.mockResolvedValueOnce({ error: 'expired' });

    const token = 'expiredtoken';
    const res = await tokenGET(
      makeRequest('GET', `/api/setu/invite/${token}`),
      { params: Promise.resolve({ token }) },
    );

    expect(res.status).toBe(410);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/expired/);
  });

  it('accept returns 410 when invite is past expiresAt', async () => {
    vi.useFakeTimers();
    const past = new Date('2026-01-01T00:00:00.000Z');
    const futureNow = new Date('2026-06-01T00:00:00.000Z');
    vi.setSystemTime(futureNow);

    const token = 'expiredtoken';
    const inviteDoc = makeInviteDoc({
      token,
      expiresAt: { _seconds: Math.floor(past.getTime() / 1000), toDate: () => past },
    });
    const fakeRef = { parent: { parent: { id: FID } } };
    mockCollectionGroupGet.mockResolvedValueOnce({ empty: false, docs: [{ data: () => inviteDoc, ref: fakeRef }] });
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
    const txn = { get: vi.fn().mockResolvedValueOnce({ exists: true, data: () => inviteDoc }), set: mockFirestoreSet, update: mockFirestoreUpdate };
    return fn(txn);
  });

    sessionAs(INVITE_EMAIL);

    const res = await acceptPOST(
      makeRequest('POST', '/api/setu/invite/accept', { token }),
    );

    expect(res.status).toBe(410);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/expired/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: Already accepted
// ─────────────────────────────────────────────────────────────────────────────

describe('edge: already-accepted invite', () => {
  it('GET returns 409 when invite.acceptedAt is set', async () => {
    mockGetInviteByToken.mockResolvedValueOnce({ error: 'accepted' });

    const token = 'usedtoken';
    const res = await tokenGET(
      makeRequest('GET', `/api/setu/invite/${token}`),
      { params: Promise.resolve({ token }) },
    );

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/accepted/);
  });

  it('accept returns 409 when invite.acceptedAt is set', async () => {
    const token = 'usedtoken';
    const acceptedAt = { _seconds: 1716000000, toDate: () => new Date(1716000000 * 1000) };
    const inviteDoc = makeInviteDoc({ token, acceptedAt });
    const fakeRef = { parent: { parent: { id: FID } } };
    mockCollectionGroupGet.mockResolvedValueOnce({ empty: false, docs: [{ data: () => inviteDoc, ref: fakeRef }] });
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
    const txn = { get: vi.fn().mockResolvedValueOnce({ exists: true, data: () => inviteDoc }), set: mockFirestoreSet, update: mockFirestoreUpdate };
    return fn(txn);
  });

    sessionAs(INVITE_EMAIL);

    const res = await acceptPOST(
      makeRequest('POST', '/api/setu/invite/accept', { token }),
    );

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/accepted/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6: Wrong email (email mismatch)
// ─────────────────────────────────────────────────────────────────────────────

describe('edge: email mismatch — wrong user tries to accept', () => {
  it('accept returns 403 with email-mismatch when signed-in email != invite email', async () => {
    const token = 'validtoken123abc';
    const inviteDoc = makeInviteDoc({ token, email: 'bob@example.com' });
    const fakeRef = { parent: { parent: { id: FID } } };
    mockCollectionGroupGet.mockResolvedValueOnce({ empty: false, docs: [{ data: () => inviteDoc, ref: fakeRef }] });
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
    const txn = { get: vi.fn().mockResolvedValueOnce({ exists: true, data: () => inviteDoc }), set: mockFirestoreSet, update: mockFirestoreUpdate };
    return fn(txn);
  });

    // alice is signed in, not bob
    sessionAs('alice@example.com');

    const res = await acceptPOST(
      makeRequest('POST', '/api/setu/invite/accept', { token }),
    );

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('email-mismatch');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7: contactKey conflict — invitee already in another family
// ─────────────────────────────────────────────────────────────────────────────

describe('edge: contactKey conflict — invitee already in a different family', () => {
  it('accept returns 409 contact-conflict when contactKey belongs to a different fid', async () => {
    const token = 'validtoken123abc';
    const inviteDoc = makeInviteDoc({ token });
    const fakeRef = { parent: { parent: { id: FID } } };
    mockCollectionGroupGet.mockResolvedValueOnce({ empty: false, docs: [{ data: () => inviteDoc, ref: fakeRef }] });

    // contactKey exists but points to a different family
    const OTHER_FID = 'FAMB0002WXYZ';
    setupAcceptTransaction({ contactKeyExists: true, contactKeyFid: OTHER_FID, inviteData: inviteDoc });

    sessionAs(INVITE_EMAIL);

    const res = await acceptPOST(
      makeRequest('POST', '/api/setu/invite/accept', { token }),
    );

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/contact-already-registered|contact-conflict/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 8: Non-manager tries to send → 403
// ─────────────────────────────────────────────────────────────────────────────

describe('edge: non-manager cannot send invite', () => {
  it('send returns 403 when role is family-member', async () => {
    const res = await sendPOST(
      makeRequest(
        'POST',
        '/api/setu/invite/send',
        { email: INVITE_EMAIL, relation: INVITE_RELATION },
        memberHeaders(),
      ),
    );

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('manager-required');
  });

  it('send returns 401 when no auth headers at all', async () => {
    const res = await sendPOST(
      makeRequest('POST', '/api/setu/invite/send', { email: INVITE_EMAIL, relation: INVITE_RELATION }),
    );

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('no-session');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 9: Token tampered / non-existent → GET 404
// ─────────────────────────────────────────────────────────────────────────────

describe('edge: tampered or non-existent token', () => {
  it('GET returns 404 when token doc does not exist', async () => {
    mockGetInviteByToken.mockResolvedValueOnce({ error: 'not-found' });

    const token = 'nonexistent-token-xyz';
    const res = await tokenGET(
      makeRequest('GET', `/api/setu/invite/${token}`),
      { params: Promise.resolve({ token }) },
    );

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not-found/);
  });

  it('accept returns 404 when token doc does not exist', async () => {
    mockCollectionGroupGet.mockResolvedValueOnce({ empty: true, docs: [] });

    sessionAs(INVITE_EMAIL);

    const res = await acceptPOST(
      makeRequest('POST', '/api/setu/invite/accept', { token: 'tampered-abc123' }),
    );

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not-found/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 10 (flag off): all three endpoints return 404 when setuAuth is off
// ─────────────────────────────────────────────────────────────────────────────

describe('feature flag off: all invite endpoints return 404', () => {
  it('send returns 404', async () => {
    flagsMock.setuAuth = false;

    const res = await sendPOST(
      makeRequest(
        'POST',
        '/api/setu/invite/send',
        { email: INVITE_EMAIL, relation: INVITE_RELATION },
        managerHeaders(),
      ),
    );

    expect(res.status).toBe(404);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('GET invite/[token] returns 404', async () => {
    flagsMock.setuAuth = false;
    const token = 'anytoken';

    const res = await tokenGET(
      makeRequest('GET', `/api/setu/invite/${token}`),
      { params: Promise.resolve({ token }) },
    );

    expect(res.status).toBe(404);
    expect(mockFirestoreGet).not.toHaveBeenCalled();
  });

  it('accept returns 404', async () => {
    flagsMock.setuAuth = false;

    sessionAs(INVITE_EMAIL);

    const res = await acceptPOST(
      makeRequest('POST', '/api/setu/invite/accept', { token: 'anytoken' }),
    );

    expect(res.status).toBe(404);
    expect(mockFirestoreGet).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: accept with no session → 401
// ─────────────────────────────────────────────────────────────────────────────

describe('accept: unauthenticated', () => {
  it('returns 401 when no session cookie', async () => {
    mockCookiesGet.mockReturnValue(null);

    const res = await acceptPOST(
      makeRequest('POST', '/api/setu/invite/accept', { token: 'sometoken' }),
    );

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: resolveSender called with right args on happy send
// ─────────────────────────────────────────────────────────────────────────────

describe('send: email normalization', () => {
  it('normalizes invitee email to lowercase before writing and sending', async () => {
    setupSendTransaction();

    await sendPOST(
      makeRequest(
        'POST',
        '/api/setu/invite/send',
        { email: 'BOB@EXAMPLE.COM', relation: 'Sibling' },
        managerHeaders(),
      ),
    );

    const emailCall = mockSendEmail.mock.calls[0]![0]! as { to: string };
    expect(emailCall.to).toBe('bob@example.com');

    const docData = mockFirestoreSet.mock.calls[0]![1]! as Record<string, unknown>;
    expect(docData.email).toBe('bob@example.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: expiresAt TTL is exactly 14 days from send time
// ─────────────────────────────────────────────────────────────────────────────

describe('send: TTL correctness', () => {
  it('expiresAt is 14 days from the moment of send', async () => {
    const now = new Date('2026-05-23T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    setupSendTransaction();

    await sendPOST(
      makeRequest(
        'POST',
        '/api/setu/invite/send',
        { email: INVITE_EMAIL, relation: INVITE_RELATION },
        managerHeaders(),
      ),
    );

    const { Timestamp } = await import('@cmt/firebase-shared/admin/firestore');
    const expected = new Date(now.getTime() + 14 * 86400_000);
    expect(Timestamp.fromDate).toHaveBeenCalledWith(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TODO: rate-limit / double-send scenario not required for this slice.
// The send route shares the same `invites` subcollection — a second send with
// the same email would simply write a new token doc; rate limiting is not
// enforced at this layer (left for Slice 4 / admin hardening).
// ─────────────────────────────────────────────────────────────────────────────
