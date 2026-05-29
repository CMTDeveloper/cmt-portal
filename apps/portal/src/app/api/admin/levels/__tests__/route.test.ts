import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockCreate = vi.fn();
const mockPeriodGet = vi.fn();
const mockCollection = vi.fn();

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const Timestamp = {
    now: () => ({ toDate: () => new Date() }),
    fromDate: (d: Date) => ({ toDate: () => d }),
  };
  const FieldValue = { serverTimestamp: () => 'SERVER_TS' };
  return { Timestamp, FieldValue, portalFirestore: vi.fn(() => ({ collection: mockCollection })) };
});

const validBody = {
  programKey: 'bala-vihar',
  location: 'Brampton',
  pid: 'bv-brampton-2025-26',
  levelName: 'Level 2',
  levelKind: 'level',
  order: 4,
  gradeBand: ['Gr 2', 'Gr 3'],
  ageLabel: 'Gr 2 & 3',
  curriculum: 'Hanuman',
  enabled: true,
};

function makeRequest(method: string, body?: unknown, uid?: string, role = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-portal-role': role };
  if (uid) headers['x-portal-uid'] = uid;
  return new Request('http://localhost/api/admin/levels', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function makeTs(d: Date) {
  return { toDate: () => d };
}

beforeEach(() => {
  vi.clearAllMocks();
  // levels.doc(id) → { create, get }; donationPeriods.doc(pid) → { get: mockPeriodGet }
  mockCollection.mockImplementation((name: string) => {
    if (name === 'donationPeriods') {
      return { doc: vi.fn(() => ({ get: mockPeriodGet })) };
    }
    const orderByChain: { orderBy: () => typeof orderByChain; get: typeof mockGet } = {
      orderBy: () => orderByChain,
      get: mockGet,
    };
    return {
      orderBy: () => orderByChain,
      doc: vi.fn(() => ({ create: mockCreate, get: mockGet })),
    };
  });
  mockGet.mockResolvedValue({ docs: [] });
  mockCreate.mockResolvedValue(undefined);
  mockPeriodGet.mockResolvedValue({ exists: true, data: () => ({ periodLabel: '2025-26' }) });
});

describe('GET /api/admin/levels', () => {
  it('returns 403 for non-admin', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET', undefined, undefined, 'family-manager'));
    expect(res.status).toBe(403);
  });

  it('returns 200 with empty levels', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).levels).toEqual([]);
  });

  it('serializes timestamps to ISO strings', async () => {
    const now = new Date('2025-09-01T00:00:00.000Z');
    mockGet.mockResolvedValue({
      docs: [
        {
          data: () => ({
            levelId: 'brampton-level-2-bv-brampton-2025-26',
            levelName: 'Level 2',
            createdAt: makeTs(now),
            updatedAt: makeTs(now),
          }),
        },
      ],
    });
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET'));
    const body = await res.json();
    expect(body.levels).toHaveLength(1);
    expect(typeof body.levels[0].createdAt).toBe('string');
  });
});

describe('POST /api/admin/levels', () => {
  it('returns 403 for non-admin', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin', 'welcome-team'));
    expect(res.status).toBe(403);
  });

  it('returns 401 without x-portal-uid', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody));
    expect(res.status).toBe(401);
  });

  it('returns 400 for a level with empty gradeBand', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { ...validBody, gradeBand: [] }, 'uid-admin'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the period does not exist', async () => {
    mockPeriodGet.mockResolvedValue({ exists: false });
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('period-not-found');
  });

  it('returns 201 with derived levelId', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(res.status).toBe(201);
    expect((await res.json()).levelId).toBe('brampton-level-2-bv-brampton-2025-26');
  });

  it('derives a safe levelId for "Pre-Level A"', async () => {
    const { POST } = await import('../route');
    const res = await POST(
      makeRequest('POST', { ...validBody, location: 'Scarborough', levelName: 'Pre-Level A', levelKind: 'pre-level', gradeBand: ['JK', 'SK'] }, 'uid-admin'),
    );
    expect((await res.json()).levelId).toBe('scarborough-pre-level-a-bv-brampton-2025-26');
  });

  it('returns 201 for a parents level with empty gradeBand', async () => {
    const { POST } = await import('../route');
    const res = await POST(
      makeRequest('POST', { ...validBody, levelName: 'Parents', levelKind: 'parents', gradeBand: [], ageLabel: 'All Adults', curriculum: 'Gita' }, 'uid-admin'),
    );
    expect(res.status).toBe(201);
  });

  it('returns 409 when create() throws ALREADY_EXISTS (code 6)', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('exists'), { code: 6 }));
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('level-conflict');
  });
});
