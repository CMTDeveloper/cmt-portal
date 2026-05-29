import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── next/cache ─────────────────────────────────────────────────────────────────
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

// ── Feature flag ───────────────────────────────────────────────────────────────
const flagsMock = vi.hoisted(() => ({ setuAuth: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

// ── Firestore ──────────────────────────────────────────────────────────────────
const mockRunTransaction = vi.hoisted(() => vi.fn());
const mockCollectionGet = vi.hoisted(() => vi.fn());
const mockDocGet = vi.hoisted(() => vi.fn());
const mockDocUpdate = vi.hoisted(() => vi.fn());

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const makeDoc = (id: string, getFn: ReturnType<typeof vi.fn>) => ({
    id,
    get: getFn,
    set: vi.fn(),
    update: mockDocUpdate,
    delete: vi.fn(),
    ref: { update: mockDocUpdate },
    collection: vi.fn().mockImplementation((_sub: string) => ({
      doc: vi.fn().mockImplementation((_sid?: string) => makeDoc(_sid ?? 'sub-id', mockDocGet)),
      get: mockCollectionGet,
      orderBy: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    })),
  });

  return {
    portalFirestore: vi.fn(() => ({
      collection: vi.fn().mockImplementation((_name: string) => ({
        doc: vi.fn().mockImplementation((_id?: string) => makeDoc(_id ?? 'auto-id', mockDocGet)),
        get: mockCollectionGet,
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      })),
      collectionGroup: vi.fn().mockImplementation((_name: string) => ({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: mockCollectionGet,
      })),
      runTransaction: mockRunTransaction,
    })),
    FieldValue: {
      serverTimestamp: vi.fn(() => 'SERVER_TS'),
    },
    Timestamp: {
      fromDate: vi.fn((d: Date) => ({ toDate: () => d })),
    },
  };
});

// ── Route handlers ─────────────────────────────────────────────────────────────
import { GET as enrollmentsGET, POST as enrollmentsPOST } from '../enrollments/route';
import { DELETE as enrollmentDELETE } from '../enrollments/[eid]/route';

// ── Welcome-team route handlers ────────────────────────────────────────────────
import { POST as welcomeEnrollPOST } from '../../welcome/enrollments/route';
import { PATCH as welcomeOverridePATCH } from '../../welcome/enrollments/[eid]/override/route';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const FID = 'CMT-AAAA1111';
const PID = 'bv-brampton-fall-2026';
const EID = `${FID}-${PID}`;
const MID = `${FID}-01`;

const NOW = new Date();
const PAST = new Date(NOW.getTime() - 86400_000 * 30);
const PAST_FAR = new Date(NOW.getTime() - 86400_000 * 60);
const FUTURE = new Date(NOW.getTime() + 86400_000 * 30);

const ACTIVE_PERIOD = {
  pid: PID,
  programKey: 'bala-vihar',
  programLabel: 'Bala Vihar',
  location: 'Brampton',
  periodLabel: 'Fall 2026',
  startDate: { toDate: () => PAST },
  endDate: { toDate: () => FUTURE },
  // Tier effectiveFrom in the far past so resolveSuggestedAmount(period, now) = 500
  pricingTiers: [{ effectiveFrom: '2020-01-01', amountCAD: 500, label: 'Full year' }],
  enabled: true,
  createdAt: { toDate: () => PAST },
  updatedAt: { toDate: () => PAST },
  createdBy: 'admin-uid',
  updatedBy: 'admin-uid',
};

const ACTIVE_ENROLLMENT = {
  eid: EID,
  fid: FID,
  pid: PID,
  programLabel: 'Bala Vihar',
  periodLabel: 'Fall 2026',
  location: 'Brampton',
  enrolledAt: { toDate: () => PAST },
  enrolledVia: 'family-initiated',
  enrolledByMid: MID,
  childrenMids: [],
  suggestedAmountSnapshot: 500,
  suggestedAmountOverride: null,
  status: 'active',
  cancelledAt: null,
  cancelledReason: null,
};

// ── Request factories ──────────────────────────────────────────────────────────

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

function managerHeaders(): Record<string, string> {
  return { 'x-portal-role': 'family-manager', 'x-portal-fid': FID, 'x-portal-mid': MID };
}

function memberHeaders(): Record<string, string> {
  return { 'x-portal-role': 'family-member', 'x-portal-fid': FID, 'x-portal-mid': MID };
}

function welcomeHeaders(): Record<string, string> {
  return { 'x-portal-role': 'welcome-team' };
}

function adminAsWelcomeHeaders(): Record<string, string> {
  return { 'x-portal-role': 'admin' };
}

function managerViaExtraRoleHeaders(): Record<string, string> {
  return { 'x-portal-role': 'family-member', 'x-portal-fid': FID, 'x-portal-mid': MID, 'x-portal-extra-roles': 'family-manager' };
}

type RouteCtx<K extends string> = { params: Promise<Record<K, string>> };
function makeCtx<K extends string>(key: K, value: string): RouteCtx<K> {
  return { params: Promise.resolve({ [key]: value } as Record<K, string>) };
}

// ── Enrollment transaction helpers ─────────────────────────────────────────────

function setupEnrollTransaction({
  familyExists = true,
  periodExists = true,
  periodEnabled = true,
  periodCurrent = true,
  periodFuture = false,
  periodExpired = false,
  enrollmentExists = false,
  enrollmentStatus = 'active',
  childMids = [] as string[],
} = {}) {
  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
    let period = ACTIVE_PERIOD;
    if (periodFuture) {
      period = { ...ACTIVE_PERIOD, startDate: { toDate: () => FUTURE }, endDate: { toDate: () => new Date(FUTURE.getTime() + 86400_000 * 30) } };
    } else if (periodExpired) {
      period = { ...ACTIVE_PERIOD, startDate: { toDate: () => PAST_FAR }, endDate: { toDate: () => PAST } };
    } else if (!periodCurrent) {
      // legacy: treated as future (startDate > now)
      period = { ...ACTIVE_PERIOD, startDate: { toDate: () => FUTURE }, endDate: { toDate: () => FUTURE } };
    }

    const membersDocs = childMids.map((mid) => ({ data: () => ({ type: 'Child', mid }) }));

    // Call order from enroll-family.ts:
    //   Promise.all([period, enrollment, family]) → calls 1, 2, 3 (in parallel, resolved in any order)
    //   members subcollection query               → call 4
    const txn = {
      get: vi.fn()
        .mockResolvedValueOnce({ exists: periodExists, data: () => ({ ...period, enabled: periodEnabled }) })
        .mockResolvedValueOnce({ exists: enrollmentExists, data: () => ({ ...ACTIVE_ENROLLMENT, status: enrollmentStatus }) })
        .mockResolvedValueOnce({ exists: familyExists })
        .mockResolvedValue({ docs: membersDocs, size: membersDocs.length }),
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    return fn(txn);
  });
}

function setupCancelTransaction({ exists = true, status = 'active' } = {}) {
  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
    const txn = {
      get: vi.fn().mockResolvedValueOnce({ exists, data: () => ({ status }) }),
      update: vi.fn(),
    };
    return fn(txn);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuAuth = true;
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/setu/enrollments
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/setu/enrollments', () => {
  it('returns empty array when family has no enrollments', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

    const res = await enrollmentsGET(makeRequest('GET', '/api/setu/enrollments', null, managerHeaders()));
    expect(res.status).toBe(200);
    const body = await res.json() as { enrollments: unknown[] };
    expect(body.enrollments).toHaveLength(0);
  });

  it('returns enrollments with effectiveSuggestedAmount from snapshot when no override', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ data: () => ACTIVE_ENROLLMENT }],
    });
    // Period lookup
    mockDocGet.mockResolvedValue({ exists: true, data: () => ACTIVE_PERIOD });

    const res = await enrollmentsGET(makeRequest('GET', '/api/setu/enrollments', null, managerHeaders()));
    expect(res.status).toBe(200);
    const body = await res.json() as { enrollments: { effectiveSuggestedAmount: number; eid: string }[] };
    expect(body.enrollments[0]!.eid).toBe(EID);
    expect(body.enrollments[0]!.effectiveSuggestedAmount).toBe(500);
  });

  it('effectiveSuggestedAmount uses override when set', async () => {
    const enrollmentWithOverride = { ...ACTIVE_ENROLLMENT, suggestedAmountOverride: 250 };
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ data: () => enrollmentWithOverride }],
    });
    mockDocGet.mockResolvedValue({ exists: true, data: () => ACTIVE_PERIOD });

    const res = await enrollmentsGET(makeRequest('GET', '/api/setu/enrollments', null, managerHeaders()));
    const body = await res.json() as { enrollments: { effectiveSuggestedAmount: number }[] };
    expect(body.enrollments[0]!.effectiveSuggestedAmount).toBe(250);
  });

  it('returns 401 when no fid header', async () => {
    const res = await enrollmentsGET(makeRequest('GET', '/api/setu/enrollments'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when feature flag off', async () => {
    flagsMock.setuAuth = false;
    const res = await enrollmentsGET(makeRequest('GET', '/api/setu/enrollments', null, managerHeaders()));
    expect(res.status).toBe(404);
  });

  it('family-member can GET enrollments (read-only)', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    const res = await enrollmentsGET(makeRequest('GET', '/api/setu/enrollments', null, memberHeaders()));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/setu/enrollments — idempotency + snapshot invariant
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/setu/enrollments', () => {
  it('creates enrollment and returns 201 with eid + suggestedAmount', async () => {
    setupEnrollTransaction();

    const res = await enrollmentsPOST(
      makeRequest('POST', '/api/setu/enrollments', { pid: PID }, managerHeaders()),
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { eid: string; suggestedAmount: number; donateUrl: string };
    expect(body.eid).toBe(EID);
    expect(body.suggestedAmount).toBe(500);
    expect(body.donateUrl).toContain(EID);
  });

  it('idempotent: re-enrolling active family returns 200 not 201', async () => {
    setupEnrollTransaction({ enrollmentExists: true, enrollmentStatus: 'active' });

    const res = await enrollmentsPOST(
      makeRequest('POST', '/api/setu/enrollments', { pid: PID }, managerHeaders()),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { eid: string };
    expect(body.eid).toBe(EID);
  });

  it('snapshot invariant: suggestedAmount is the tier resolved at txn time', async () => {
    // The snapshot pins the resolved tier amount at create time; later admin
    // tier edits never change an existing enrollment.
    setupEnrollTransaction();

    const res = await enrollmentsPOST(
      makeRequest('POST', '/api/setu/enrollments', { pid: PID }, managerHeaders()),
    );
    const body = await res.json() as { suggestedAmount: number };
    // The single far-past tier resolves to 500 regardless of enrollment date.
    expect(body.suggestedAmount).toBe(500);
  });

  it('returns 404 when period does not exist', async () => {
    setupEnrollTransaction({ periodExists: false });

    const res = await enrollmentsPOST(
      makeRequest('POST', '/api/setu/enrollments', { pid: PID }, managerHeaders()),
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('period-not-found');
  });

  it('returns 422 when period is disabled', async () => {
    setupEnrollTransaction({ periodEnabled: false });

    const res = await enrollmentsPOST(
      makeRequest('POST', '/api/setu/enrollments', { pid: PID }, managerHeaders()),
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('period-disabled');
  });

  it('returns 422 with period-not-yet-open when period starts in the future', async () => {
    setupEnrollTransaction({ periodFuture: true });

    const res = await enrollmentsPOST(
      makeRequest('POST', '/api/setu/enrollments', { pid: PID }, managerHeaders()),
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('period-not-yet-open');
  });

  it('returns 422 with period-expired when period end date is in the past', async () => {
    setupEnrollTransaction({ periodExpired: true });

    const res = await enrollmentsPOST(
      makeRequest('POST', '/api/setu/enrollments', { pid: PID }, managerHeaders()),
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('period-expired');
  });

  it('returns 403 for family-member (non-manager)', async () => {
    const res = await enrollmentsPOST(
      makeRequest('POST', '/api/setu/enrollments', { pid: PID }, memberHeaders()),
    );
    expect(res.status).toBe(403);
  });

  it('multi-role: family-member with extraRoles=family-manager can enroll (201)', async () => {
    setupEnrollTransaction();
    const res = await enrollmentsPOST(
      makeRequest('POST', '/api/setu/enrollments', { pid: PID }, managerViaExtraRoleHeaders()),
    );
    expect(res.status).toBe(201);
  });

  it('returns 401 when no auth headers', async () => {
    const res = await enrollmentsPOST(
      makeRequest('POST', '/api/setu/enrollments', { pid: PID }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on missing pid', async () => {
    const res = await enrollmentsPOST(
      makeRequest('POST', '/api/setu/enrollments', {}, managerHeaders()),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when feature flag off', async () => {
    flagsMock.setuAuth = false;
    const res = await enrollmentsPOST(
      makeRequest('POST', '/api/setu/enrollments', { pid: PID }, managerHeaders()),
    );
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/setu/enrollments/:eid
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/setu/enrollments/:eid', () => {
  it('manager can cancel active enrollment', async () => {
    setupCancelTransaction({ exists: true, status: 'active' });

    const res = await enrollmentDELETE(
      makeRequest('DELETE', `/api/setu/enrollments/${EID}`, null, managerHeaders()),
      makeCtx('eid', EID),
    );
    expect(res.status).toBe(200);
  });

  it('returns 404 when enrollment not found', async () => {
    setupCancelTransaction({ exists: false });

    const res = await enrollmentDELETE(
      makeRequest('DELETE', `/api/setu/enrollments/${EID}`, null, managerHeaders()),
      makeCtx('eid', EID),
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when enrollment already cancelled', async () => {
    setupCancelTransaction({ exists: true, status: 'cancelled' });

    const res = await enrollmentDELETE(
      makeRequest('DELETE', `/api/setu/enrollments/${EID}`, null, managerHeaders()),
      makeCtx('eid', EID),
    );
    expect(res.status).toBe(409);
  });

  it('returns 403 for cross-family eid (eid does not start with caller fid)', async () => {
    const res = await enrollmentDELETE(
      makeRequest('DELETE', '/api/setu/enrollments/CMT-ZZZZ9999-bv-fall', null, managerHeaders()),
      makeCtx('eid', 'CMT-ZZZZ9999-bv-fall'),
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 for family-member (non-manager)', async () => {
    const res = await enrollmentDELETE(
      makeRequest('DELETE', `/api/setu/enrollments/${EID}`, null, memberHeaders()),
      makeCtx('eid', EID),
    );
    expect(res.status).toBe(403);
  });

  it('returns 401 when no auth headers', async () => {
    const res = await enrollmentDELETE(
      makeRequest('DELETE', `/api/setu/enrollments/${EID}`),
      makeCtx('eid', EID),
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when feature flag off', async () => {
    flagsMock.setuAuth = false;
    const res = await enrollmentDELETE(
      makeRequest('DELETE', `/api/setu/enrollments/${EID}`, null, managerHeaders()),
      makeCtx('eid', EID),
    );
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/welcome/enrollments — welcome-team enroll on behalf
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/welcome/enrollments', () => {
  it('welcome-team can enroll a family on their behalf', async () => {
    setupEnrollTransaction();

    const res = await welcomeEnrollPOST(
      makeRequest('POST', '/api/welcome/enrollments', { fid: FID, pid: PID }, welcomeHeaders()),
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { eid: string };
    expect(body.eid).toBe(EID);
  });

  it('idempotent: re-enrolling active family returns 200', async () => {
    setupEnrollTransaction({ enrollmentExists: true, enrollmentStatus: 'active' });

    const res = await welcomeEnrollPOST(
      makeRequest('POST', '/api/welcome/enrollments', { fid: FID, pid: PID }, welcomeHeaders()),
    );
    expect(res.status).toBe(200);
  });

  it('returns 403 for family-manager calling welcome endpoint', async () => {
    const res = await welcomeEnrollPOST(
      makeRequest('POST', '/api/welcome/enrollments', { fid: FID, pid: PID }, managerHeaders()),
    );
    expect(res.status).toBe(403);
  });

  it('multi-role: admin (primary role=admin) can enroll via welcome endpoint', async () => {
    setupEnrollTransaction();
    const res = await welcomeEnrollPOST(
      makeRequest('POST', '/api/welcome/enrollments', { fid: FID, pid: PID }, adminAsWelcomeHeaders()),
    );
    expect(res.status).toBe(201);
  });

  it('returns 400 on missing fid or pid', async () => {
    const res = await welcomeEnrollPOST(
      makeRequest('POST', '/api/welcome/enrollments', { pid: PID }, welcomeHeaders()),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when feature flag off', async () => {
    flagsMock.setuAuth = false;
    const res = await welcomeEnrollPOST(
      makeRequest('POST', '/api/welcome/enrollments', { fid: FID, pid: PID }, welcomeHeaders()),
    );
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/welcome/enrollments/:eid/override
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/welcome/enrollments/:eid (override)', () => {
  it('welcome-team can set suggestedAmountOverride', async () => {
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [{
        ref: { update: mockDocUpdate },
        data: () => ({ status: 'active', fid: FID }),
      }],
    });

    const res = await welcomeOverridePATCH(
      makeRequest('PATCH', `/api/welcome/enrollments/${EID}`, { suggestedAmountOverride: 300 }, welcomeHeaders()),
      makeCtx('eid', EID),
    );
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedAmountOverride: 300 }),
    );
  });

  it('welcome-team can clear override by setting null', async () => {
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [{
        ref: { update: mockDocUpdate },
        data: () => ({ status: 'active', fid: FID }),
      }],
    });

    const res = await welcomeOverridePATCH(
      makeRequest('PATCH', `/api/welcome/enrollments/${EID}`, { suggestedAmountOverride: null }, welcomeHeaders()),
      makeCtx('eid', EID),
    );
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedAmountOverride: null }),
    );
  });

  it('returns 404 when enrollment not found', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

    const res = await welcomeOverridePATCH(
      makeRequest('PATCH', `/api/welcome/enrollments/${EID}`, { suggestedAmountOverride: 300 }, welcomeHeaders()),
      makeCtx('eid', EID),
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when enrollment is not active', async () => {
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [{
        ref: { update: mockDocUpdate },
        data: () => ({ status: 'cancelled', fid: FID }),
      }],
    });

    const res = await welcomeOverridePATCH(
      makeRequest('PATCH', `/api/welcome/enrollments/${EID}`, { suggestedAmountOverride: 300 }, welcomeHeaders()),
      makeCtx('eid', EID),
    );
    expect(res.status).toBe(409);
  });

  it('returns 403 for family-manager calling welcome endpoint', async () => {
    const res = await welcomeOverridePATCH(
      makeRequest('PATCH', `/api/welcome/enrollments/${EID}`, { suggestedAmountOverride: 300 }, managerHeaders()),
      makeCtx('eid', EID),
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 on invalid body (positive number required, or null)', async () => {
    const res = await welcomeOverridePATCH(
      makeRequest('PATCH', `/api/welcome/enrollments/${EID}`, { suggestedAmountOverride: -50 }, welcomeHeaders()),
      makeCtx('eid', EID),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when feature flag off', async () => {
    flagsMock.setuAuth = false;
    const res = await welcomeOverridePATCH(
      makeRequest('PATCH', `/api/welcome/enrollments/${EID}`, { suggestedAmountOverride: 300 }, welcomeHeaders()),
      makeCtx('eid', EID),
    );
    expect(res.status).toBe(404);
  });
});
