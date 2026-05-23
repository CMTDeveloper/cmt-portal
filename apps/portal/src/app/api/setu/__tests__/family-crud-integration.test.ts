import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── next/cache ────────────────────────────────────────────────────────────────
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

// ── Feature flag ──────────────────────────────────────────────────────────────
const flagsMock = vi.hoisted(() => ({ setuAuth: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

// ── next/headers — used by getCurrentFamily (GET /api/setu/family) ────────────
const mockCookiesGet = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: mockCookiesGet }),
  headers: vi.fn(() => new Headers()),
}));

// ── Firestore ─────────────────────────────────────────────────────────────────
const mockFirestoreGet = vi.hoisted(() => vi.fn());
const mockCollectionGet = vi.hoisted(() => vi.fn());
const mockRunTransaction = vi.hoisted(() => vi.fn());

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn().mockImplementation((_name: string) => ({
      doc: vi.fn().mockImplementation((_id?: string) => ({
        id: _id ?? 'auto-id',
        get: mockFirestoreGet,
        set: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
        collection: vi.fn().mockImplementation((_sub: string) => ({
          doc: vi.fn().mockReturnValue({
            id: 'sub-id',
            get: mockFirestoreGet,
            set: vi.fn(),
            delete: vi.fn(),
          }),
          get: mockCollectionGet,
          orderBy: vi.fn().mockReturnThis(),
        })),
      })),
      get: mockCollectionGet,
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
    })),
    runTransaction: mockRunTransaction,
  })),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    arrayUnion: vi.fn((...args: string[]) => ({ _union: args })),
    arrayRemove: vi.fn((...args: string[]) => ({ _remove: args })),
  },
}));

// ── Session verification — used by getCurrentFamily (GET) ─────────────────────
const mockVerifySession = vi.hoisted(() => vi.fn());
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  verifyPortalSessionCookie: mockVerifySession,
  createPortalSessionCookie: vi.fn().mockResolvedValue('fake-session-cookie'),
  exchangeCustomTokenForIdToken: vi.fn().mockResolvedValue('fake-id-token'),
}));

// ── getFamilyByFid — used by getCurrentFamily (GET /api/setu/family) ─────────
const mockGetFamilyByFid = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-family-by-fid', () => ({
  getFamilyByFid: mockGetFamilyByFid,
}));

// ── hash-contact-key ──────────────────────────────────────────────────────────
vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: (_type: string, value: string) => `hash:${value}`,
}));

// ── Route handlers ────────────────────────────────────────────────────────────
import { GET as familyGET } from '../family/route';
import { POST as membersPOST } from '../members/route';
import { PATCH as memberPATCH, DELETE as memberDELETE } from '../members/[mid]/route';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MEMBER_01_MID = 'FAMA0001ABCD-01';
const MEMBER_02_MID = 'FAMA0001ABCD-02';
const FAMILY_FID = 'FAMA0001ABCD';
const FAMILY_B_FID = 'FAMB0001WXYZ';

const FAMILY_A = {
  fid: FAMILY_FID,
  name: 'Patel',
  location: 'Brampton',
  managers: [MEMBER_01_MID],
  createdAt: { toDate: () => new Date('2024-09-01') },
  legacyFid: null,
  searchKeys: ['patel', FAMILY_FID],
};

const MEMBER_01: Record<string, unknown> = {
  mid: MEMBER_01_MID,
  uid: 'uid-raj',
  firstName: 'Raj',
  lastName: 'Patel',
  type: 'Adult',
  gender: 'Male',
  manager: true,
  joinedAt: { toDate: () => new Date('2024-09-01') },
  email: 'raj@example.com',
  phone: '4165551234',
  volunteeringSkills: [],
  foodAllergies: null,
  emergencyContacts: [null, null],
  schoolGrade: null,
  birthMonthYear: null,
};

const MEMBER_02: Record<string, unknown> = {
  mid: MEMBER_02_MID,
  uid: null,
  firstName: 'Priya',
  lastName: 'Patel',
  type: 'Adult',
  gender: 'Female',
  manager: false,
  joinedAt: { toDate: () => new Date('2024-09-01') },
  email: 'priya@example.com',
  phone: null,
  volunteeringSkills: [],
  foodAllergies: null,
  emergencyContacts: [null, null],
  schoolGrade: null,
  birthMonthYear: null,
};

const FAMILY_B = {
  fid: FAMILY_B_FID,
  name: 'Shah',
  location: 'Mississauga',
  managers: ['FAMB0001WXYZ-01'],
  createdAt: { toDate: () => new Date('2024-09-01') },
  legacyFid: null,
  searchKeys: ['shah', FAMILY_B_FID],
};

// ── Request factories ─────────────────────────────────────────────────────────

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

// ── Session mock helpers ──────────────────────────────────────────────────────

// For GET /api/setu/family — uses cookie + verifyPortalSessionCookie
function setupSessionCookieAs(role: 'family-manager' | 'family-member', fid: string, mid: string) {
  mockCookiesGet.mockReturnValue({ value: 'fake-session-cookie' });
  mockVerifySession.mockResolvedValue({ uid: `uid-${mid}`, role, fid, mid });
}

// For POST/DELETE — read req.headers directly
function managerHeaders(fid: string, mid: string): Record<string, string> {
  return { 'x-portal-role': 'family-manager', 'x-portal-fid': fid, 'x-portal-mid': mid, 'x-portal-uid': `uid-${mid}` };
}

function memberHeaders(fid: string, mid: string): Record<string, string> {
  return { 'x-portal-role': 'family-member', 'x-portal-fid': fid, 'x-portal-mid': mid, 'x-portal-uid': `uid-${mid}` };
}

// ── Firestore mock helpers ────────────────────────────────────────────────────

function setupFamilyFirestoreForGet(members: Record<string, unknown>[]) {
  const family = {
    fid: FAMILY_A.fid,
    legacyFid: FAMILY_A.legacyFid,
    name: FAMILY_A.name,
    location: FAMILY_A.location,
    createdAt: FAMILY_A.createdAt.toDate(),
    managers: FAMILY_A.managers,
    searchKeys: FAMILY_A.searchKeys,
  };
  const mappedMembers = members.map((m) => ({
    mid: m.mid,
    uid: m.uid ?? null,
    firstName: m.firstName,
    lastName: m.lastName,
    type: m.type,
    gender: m.gender,
    manager: m.manager ?? false,
    joinedAt: (m.joinedAt as { toDate: () => Date }).toDate(),
    email: m.email ?? null,
    phone: m.phone ?? null,
    schoolGrade: m.schoolGrade ?? null,
    birthMonthYear: m.birthMonthYear ?? null,
    volunteeringSkills: m.volunteeringSkills ?? [],
    foodAllergies: m.foodAllergies ?? null,
    emergencyContacts: m.emergencyContacts ?? [null, null],
  }));
  mockGetFamilyByFid.mockResolvedValue({ family, members: mappedMembers });
}

function setupTransaction(outcome: 'success' | 'not-found', familyData = FAMILY_A, memberData: Record<string, unknown> = MEMBER_02) {
  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
    const memberExists = outcome !== 'not-found';
    const txn = {
      get: vi.fn()
        .mockResolvedValueOnce({ exists: true, data: () => familyData })
        .mockResolvedValueOnce({ exists: memberExists, data: () => memberData })
        .mockResolvedValue({ exists: false }),
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    return fn(txn);
  });
}

function setupPostTransaction(memberCount: number) {
  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
    const txn = {
      get: vi.fn()
        .mockResolvedValueOnce({ exists: true, data: () => FAMILY_A })
        .mockResolvedValueOnce({ size: memberCount, docs: [] }),
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    return fn(txn);
  });
}

type RouteCtx = { params: Promise<{ mid: string }> };

function makeCtx(mid: string): RouteCtx {
  return { params: Promise.resolve({ mid }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuAuth = true;
  mockCookiesGet.mockReturnValue(null);
  mockVerifySession.mockResolvedValue(null);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/setu/family
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/setu/family', () => {
  it('returns family + members for signed-in manager', async () => {
    setupSessionCookieAs('family-manager', FAMILY_FID, MEMBER_01_MID);
    setupFamilyFirestoreForGet([MEMBER_01, MEMBER_02]);

    const res = await familyGET(makeRequest('GET', '/api/setu/family'));
    expect(res.status).toBe(200);
    const body = await res.json() as { family: { fid: string; name: string }; members: { mid: string }[] };
    expect(body.family.fid).toBe(FAMILY_FID);
    expect(body.family.name).toBe('Patel');
    expect(body.members).toHaveLength(2);
    expect(body.members.map((m) => m.mid)).toContain(MEMBER_01_MID);
    expect(body.members.map((m) => m.mid)).toContain(MEMBER_02_MID);
  });

  it('returns family + members for signed-in non-manager member', async () => {
    setupSessionCookieAs('family-member', FAMILY_FID, MEMBER_02_MID);
    setupFamilyFirestoreForGet([MEMBER_01, MEMBER_02]);

    const res = await familyGET(makeRequest('GET', '/api/setu/family'));
    expect(res.status).toBe(200);
    const body = await res.json() as { family: { fid: string }; isManager: boolean };
    expect(body.family.fid).toBe(FAMILY_FID);
    expect(body.isManager).toBe(false);
  });

  it('returns 401 when no session cookie', async () => {
    mockCookiesGet.mockReturnValue(null);

    const res = await familyGET(makeRequest('GET', '/api/setu/family'));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/no-session/);
  });

  it('returns 401 when family doc does not exist (getCurrentFamily returns null)', async () => {
    setupSessionCookieAs('family-manager', FAMILY_FID, MEMBER_01_MID);
    mockGetFamilyByFid.mockResolvedValue(null);

    const res = await familyGET(makeRequest('GET', '/api/setu/family'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when feature flag off', async () => {
    flagsMock.setuAuth = false;
    setupSessionCookieAs('family-manager', FAMILY_FID, MEMBER_01_MID);

    const res = await familyGET(makeRequest('GET', '/api/setu/family'));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/setu/members
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/setu/members', () => {
  const newChildPayload = { firstName: 'Diya', lastName: 'Patel', type: 'Child', gender: 'Female', schoolGrade: 'Grade 5' };

  it('manager creates a new member and returns mid', async () => {
    setupPostTransaction(2);

    const res = await membersPOST(makeRequest('POST', '/api/setu/members', newChildPayload, managerHeaders(FAMILY_FID, MEMBER_01_MID)));
    expect(res.status).toBe(201);
    const body = await res.json() as { mid: string };
    expect(body.mid).toBeDefined();
    expect(body.mid).toMatch(new RegExp(`^${FAMILY_FID}-`));
  });

  it('non-manager cannot POST → 403', async () => {
    const res = await membersPOST(makeRequest('POST', '/api/setu/members', newChildPayload, memberHeaders(FAMILY_FID, MEMBER_02_MID)));
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/manager-required/);
  });

  it('returns 401 when no auth headers', async () => {
    const res = await membersPOST(makeRequest('POST', '/api/setu/members', newChildPayload));
    expect(res.status).toBe(401);
  });

  it('returns 400 on missing required fields', async () => {
    const res = await membersPOST(makeRequest('POST', '/api/setu/members', { firstName: 'Diya' }, managerHeaders(FAMILY_FID, MEMBER_01_MID)));
    expect(res.status).toBe(400);
  });

  it('returns 404 when feature flag off', async () => {
    flagsMock.setuAuth = false;

    const res = await membersPOST(makeRequest('POST', '/api/setu/members', newChildPayload, managerHeaders(FAMILY_FID, MEMBER_01_MID)));
    expect(res.status).toBe(404);
  });

  it('race condition: two concurrent POSTs with same email — first succeeds, second throws', async () => {
    let callCount = 0;
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      callCount++;
      if (callCount === 1) {
        const txn = {
          get: vi.fn()
            .mockResolvedValueOnce({ exists: true, data: () => FAMILY_A })
            .mockResolvedValueOnce({ size: 2, docs: [] }),
          set: vi.fn(), update: vi.fn(), delete: vi.fn(),
        };
        return fn(txn);
      }
      throw Object.assign(new Error('Contact already registered'), { code: 'duplicate-contact' });
    });

    const payload = { firstName: 'Arjun', lastName: 'Patel', type: 'Adult', gender: 'Male', email: 'arjun@example.com' };
    const results = await Promise.allSettled([
      membersPOST(makeRequest('POST', '/api/setu/members', payload, managerHeaders(FAMILY_FID, MEMBER_01_MID))),
      membersPOST(makeRequest('POST', '/api/setu/members', payload, managerHeaders(FAMILY_FID, MEMBER_01_MID))),
    ]);

    const statuses = await Promise.all(results.map(async (r) => (r.status === 'fulfilled' ? r.value.status : 500)));
    expect(statuses).toContain(201);
    // Second call throws — route rethrows → 500 (not explicitly caught in members/route.ts)
    expect(statuses.some((s) => s !== 201)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/setu/members/:mid
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/setu/members/:mid', () => {
  it('manager can PATCH another member', async () => {
    setupTransaction('success', FAMILY_A, MEMBER_02);

    const res = await memberPATCH(
      makeRequest('PATCH', `/api/setu/members/${MEMBER_02_MID}`, { schoolGrade: 'Grade 6' }, managerHeaders(FAMILY_FID, MEMBER_01_MID)),
      makeCtx(MEMBER_02_MID),
    );
    expect(res.status).toBe(200);
  });

  it('non-manager can PATCH their own profile (self-edit)', async () => {
    setupTransaction('success', FAMILY_A, MEMBER_02);

    const res = await memberPATCH(
      makeRequest('PATCH', `/api/setu/members/${MEMBER_02_MID}`, { foodAllergies: 'Peanuts' }, memberHeaders(FAMILY_FID, MEMBER_02_MID)),
      makeCtx(MEMBER_02_MID),
    );
    expect(res.status).toBe(200);
  });

  it('non-manager cannot PATCH another member → 403', async () => {
    const res = await memberPATCH(
      makeRequest('PATCH', `/api/setu/members/${MEMBER_01_MID}`, { foodAllergies: 'None' }, memberHeaders(FAMILY_FID, MEMBER_02_MID)),
      makeCtx(MEMBER_01_MID),
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/manager-required/);
  });

  it('non-manager cannot toggle manager field → 403', async () => {
    const res = await memberPATCH(
      makeRequest('PATCH', `/api/setu/members/${MEMBER_02_MID}`, { manager: true }, memberHeaders(FAMILY_FID, MEMBER_02_MID)),
      makeCtx(MEMBER_02_MID),
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/manager-flag-requires-manager-role/);
  });

  it('PATCH email change uses a transaction (atomicity)', async () => {
    setupTransaction('success', FAMILY_A, MEMBER_02);

    const res = await memberPATCH(
      makeRequest('PATCH', `/api/setu/members/${MEMBER_02_MID}`, { email: 'priya.new@example.com' }, managerHeaders(FAMILY_FID, MEMBER_01_MID)),
      makeCtx(MEMBER_02_MID),
    );
    expect(res.status).toBe(200);
    expect(mockRunTransaction).toHaveBeenCalledOnce();
  });

  it('returns 404 when mid does not exist in family', async () => {
    setupTransaction('not-found', FAMILY_A, MEMBER_02);

    const res = await memberPATCH(
      makeRequest('PATCH', '/api/setu/members/FAMZ9999-99', { foodAllergies: 'None' }, managerHeaders(FAMILY_FID, MEMBER_01_MID)),
      makeCtx('FAMZ9999-99'),
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 when no auth headers', async () => {
    const res = await memberPATCH(
      makeRequest('PATCH', `/api/setu/members/${MEMBER_02_MID}`, { foodAllergies: 'None' }),
      makeCtx(MEMBER_02_MID),
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when feature flag off', async () => {
    flagsMock.setuAuth = false;

    const res = await memberPATCH(
      makeRequest('PATCH', `/api/setu/members/${MEMBER_02_MID}`, { foodAllergies: 'None' }, managerHeaders(FAMILY_FID, MEMBER_01_MID)),
      makeCtx(MEMBER_02_MID),
    );
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/setu/members/:mid
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/setu/members/:mid', () => {
  it('manager can delete a non-manager member', async () => {
    setupTransaction('success', FAMILY_A, MEMBER_02);

    const res = await memberDELETE(
      makeRequest('DELETE', `/api/setu/members/${MEMBER_02_MID}`, null, managerHeaders(FAMILY_FID, MEMBER_01_MID)),
      makeCtx(MEMBER_02_MID),
    );
    expect(res.status).toBe(200);
  });

  it('non-manager cannot DELETE → 403', async () => {
    const res = await memberDELETE(
      makeRequest('DELETE', `/api/setu/members/${MEMBER_01_MID}`, null, memberHeaders(FAMILY_FID, MEMBER_02_MID)),
      makeCtx(MEMBER_01_MID),
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/manager-required/);
  });

  it('DELETE last manager → 409 (last-manager guard)', async () => {
    const singleManagerFamily = { ...FAMILY_A, managers: [MEMBER_01_MID] };
    setupTransaction('success', singleManagerFamily, MEMBER_01);

    const res = await memberDELETE(
      makeRequest('DELETE', `/api/setu/members/${MEMBER_01_MID}`, null, managerHeaders(FAMILY_FID, MEMBER_01_MID)),
      makeCtx(MEMBER_01_MID),
    );
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/last-manager/);
  });

  it('DELETE uses a transaction (contactKey docs removed atomically)', async () => {
    setupTransaction('success', FAMILY_A, MEMBER_02);

    const res = await memberDELETE(
      makeRequest('DELETE', `/api/setu/members/${MEMBER_02_MID}`, null, managerHeaders(FAMILY_FID, MEMBER_01_MID)),
      makeCtx(MEMBER_02_MID),
    );
    expect(res.status).toBe(200);
    expect(mockRunTransaction).toHaveBeenCalledOnce();
  });

  it('cross-family: manager from Family B cannot DELETE member in Family A → 404', async () => {
    // Family B manager's fid is FAMB; looking up families/FAMB/members/FAMA-02 returns not-found
    setupTransaction('not-found', FAMILY_B, MEMBER_02);

    const res = await memberDELETE(
      makeRequest('DELETE', `/api/setu/members/${MEMBER_02_MID}`, null, managerHeaders(FAMILY_B_FID, 'FAMB0001WXYZ-01')),
      makeCtx(MEMBER_02_MID),
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 when no auth headers', async () => {
    const res = await memberDELETE(
      makeRequest('DELETE', `/api/setu/members/${MEMBER_02_MID}`),
      makeCtx(MEMBER_02_MID),
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when feature flag off', async () => {
    flagsMock.setuAuth = false;

    const res = await memberDELETE(
      makeRequest('DELETE', `/api/setu/members/${MEMBER_02_MID}`, null, managerHeaders(FAMILY_FID, MEMBER_01_MID)),
      makeCtx(MEMBER_02_MID),
    );
    expect(res.status).toBe(404);
  });
});
