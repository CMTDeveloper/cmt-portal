import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

// ── Firestore mock ─────────────────────────────────────────────────────────────
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockOrderBy = vi.fn();
const mockWhere = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const Timestamp = {
    now: () => ({ toDate: () => new Date() }),
    fromDate: (d: Date) => ({ toDate: () => d }),
  };
  const FieldValue = {
    serverTimestamp: () => 'SERVER_TS',
  };
  return {
    Timestamp,
    FieldValue,
    portalFirestore: vi.fn(() => ({
      collection: mockCollection,
    })),
  };
});

const FUTURE_START = '2027-09-01T04:00:00.000Z';
const FUTURE_END = '2027-12-31T04:59:59.000Z';

const validBody = {
  programKey: 'bala-vihar',
  location: 'Brampton',
  periodLabel: 'Fall 2027',
  startDate: FUTURE_START,
  endDate: FUTURE_END,
  suggestedAmount: 500,
  amountTiers: [500, 750, 1000],
  enabled: true,
};

function makeRequest(method: string, body?: unknown, uid?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (uid) headers['x-portal-uid'] = uid;
  return new Request('http://localhost/api/admin/donation-periods', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function makeTimestamp(d: Date) {
  return { toDate: () => d };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default GET setup: empty collection
  mockOrderBy.mockReturnValue({ get: mockGet });
  mockWhere.mockReturnThis();
  mockDoc.mockReturnValue({
    set: mockSet,
    get: mockGet,
  });
  mockCollection.mockReturnValue({
    orderBy: mockOrderBy,
    where: mockWhere,
    doc: mockDoc,
    get: mockGet,
  });
  mockGet.mockResolvedValue({ docs: [] });
  mockSet.mockResolvedValue(undefined);
});

// ── GET /api/admin/donation-periods ───────────────────────────────────────────

describe('GET /api/admin/donation-periods', () => {
  it('returns 200 with empty periods array when collection is empty', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);
    const body = await res.json() as { periods: unknown[] };
    expect(body.periods).toEqual([]);
  });

  it('returns 200 with serialized periods when collection has docs', async () => {
    const now = new Date('2027-01-01T00:00:00.000Z');
    const periodData = {
      pid: 'bala-vihar-brampton-fall-2027',
      programKey: 'bala-vihar',
      programLabel: 'Bala Vihar',
      location: 'Brampton',
      periodLabel: 'Fall 2027',
      startDate: makeTimestamp(new Date(FUTURE_START)),
      endDate: makeTimestamp(new Date(FUTURE_END)),
      suggestedAmount: 500,
      amountTiers: [500, 750, 1000],
      enabled: true,
      createdAt: makeTimestamp(now),
      createdBy: 'uid-admin',
      updatedAt: makeTimestamp(now),
      updatedBy: 'uid-admin',
    };
    mockOrderBy.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        docs: [{ data: () => periodData }],
      }),
    });

    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);
    const body = await res.json() as { periods: Array<{ pid: string; startDate: string }> };
    expect(body.periods).toHaveLength(1);
    expect(body.periods[0]!.pid).toBe('bala-vihar-brampton-fall-2027');
    expect(typeof body.periods[0]!.startDate).toBe('string');
  });
});

// ── POST /api/admin/donation-periods ──────────────────────────────────────────

describe('POST /api/admin/donation-periods', () => {
  it('returns 401 when no x-portal-uid header', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('no-session');
  });

  it('returns 400 when body is invalid JSON', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/admin/donation-periods', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-portal-uid': 'uid-admin' },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when suggestedAmount is 0', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { ...validBody, suggestedAmount: 0 }, 'uid-admin'));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('bad-request');
  });

  it('returns 400 when endDate is before startDate', async () => {
    const { POST } = await import('../route');
    const res = await POST(
      makeRequest('POST', { ...validBody, startDate: FUTURE_END, endDate: FUTURE_START }, 'uid-admin'),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when amountTiers is empty', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { ...validBody, amountTiers: [] }, 'uid-admin'));
    expect(res.status).toBe(400);
  });

  it('returns 201 with pid and no overlapWarning when no overlapping periods', async () => {
    // overlap query returns empty
    const overlapGet = vi.fn().mockResolvedValue({ docs: [] });
    mockWhere.mockReturnValue({ where: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: overlapGet }) }) });

    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(res.status).toBe(201);
    const body = await res.json() as { pid: string; overlapWarning: boolean };
    expect(typeof body.pid).toBe('string');
    expect(body.pid).toContain('bala-vihar');
    expect(body.overlapWarning).toBe(false);
  });

  it('returns 201 with overlapWarning:true when an overlapping enabled period exists', async () => {
    const overlappingPeriod = {
      startDate: { toDate: () => new Date('2027-08-01T00:00:00.000Z') },
      endDate: { toDate: () => new Date('2027-11-30T00:00:00.000Z') },
    };
    const overlapGet = vi.fn().mockResolvedValue({ docs: [{ data: () => overlappingPeriod }] });
    mockWhere.mockReturnValue({
      where: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ get: overlapGet }),
      }),
    });

    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(res.status).toBe(201);
    const body = await res.json() as { overlapWarning: boolean };
    expect(body.overlapWarning).toBe(true);
  });

  it('derives pid from programKey + location + periodLabel', async () => {
    const overlapGet = vi.fn().mockResolvedValue({ docs: [] });
    mockWhere.mockReturnValue({ where: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: overlapGet }) }) });

    const { POST } = await import('../route');
    const res = await POST(
      makeRequest('POST', { ...validBody, periodLabel: 'Spring 2028' }, 'uid-admin'),
    );
    const body = await res.json() as { pid: string };
    expect(body.pid).toBe('bala-vihar-brampton-spring-2028');
  });
});
