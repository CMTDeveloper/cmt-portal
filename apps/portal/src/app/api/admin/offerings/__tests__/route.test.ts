import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

// ── Firestore mock ─────────────────────────────────────────────────────────────
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockCreate = vi.fn();
const mockOrderBy = vi.fn();
const mockWhere = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const Timestamp = {
    now: () => ({ toDate: () => new Date() }),
    fromDate: (d: Date) => ({ toDate: () => d }),
  };
  const FieldValue = { serverTimestamp: () => 'SERVER_TS' };
  return {
    Timestamp,
    FieldValue,
    portalFirestore: vi.fn(() => ({ collection: mockCollection })),
  };
});

// ── getProgram mock ────────────────────────────────────────────────────────────
const mockGetProgram = vi.fn();
vi.mock('@/features/setu/programs/get-programs', () => ({
  getProgram: (...a: unknown[]) => mockGetProgram(...a),
}));

const FUTURE_START = '2027-09-01T04:00:00.000Z';
const FUTURE_END = '2027-12-31T04:59:59.000Z';

const validBody = {
  programKey: 'bala-vihar',
  location: 'Brampton',
  termLabel: '2027-28',
  termType: 'term',
  startDate: FUTURE_START,
  endDate: FUTURE_END,
  pricingTiers: [
    { effectiveFrom: '2027-09-01', amountCAD: 500, label: 'Full year' },
    { effectiveFrom: '2027-12-01', amountCAD: 300, label: 'Joined winter' },
  ],
  enabled: true,
};

function makeRequest(method: string, body?: unknown, uid?: string, role = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-portal-role': role };
  if (uid) headers['x-portal-uid'] = uid;
  return new Request('http://localhost/api/admin/offerings', {
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

  mockOrderBy.mockReturnValue({ get: mockGet });
  mockWhere.mockReturnThis();
  mockDoc.mockReturnValue({ set: mockSet, create: mockCreate, get: mockGet });
  mockCollection.mockReturnValue({
    orderBy: mockOrderBy,
    where: mockWhere,
    doc: mockDoc,
    get: mockGet,
  });
  mockGet.mockResolvedValue({ docs: [] });
  mockSet.mockResolvedValue(undefined);
  mockCreate.mockResolvedValue(undefined);

  // Default: getProgram returns a BV program
  mockGetProgram.mockResolvedValue({ programKey: 'bala-vihar', label: 'Bala Vihar', status: 'active' });
});

// ── GET /api/admin/offerings ───────────────────────────────────────────────────

describe('GET /api/admin/offerings', () => {
  it('returns 403 for non-admin role', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET', undefined, undefined, 'family-manager'));
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('admin-required');
  });

  it('returns 200 with empty offerings array when collection is empty', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);
    const body = await res.json() as { offerings: unknown[] };
    expect(body.offerings).toEqual([]);
  });

  it('returns 200 with serialized offerings when collection has docs', async () => {
    const now = new Date('2027-01-01T00:00:00.000Z');
    const offeringData = {
      oid: 'bala-vihar-brampton-2027-28',
      programKey: 'bala-vihar',
      programLabel: 'Bala Vihar',
      location: 'Brampton',
      termLabel: '2027-28',
      termType: 'term',
      startDate: makeTimestamp(new Date(FUTURE_START)),
      endDate: makeTimestamp(new Date(FUTURE_END)),
      pricingTiers: [{ effectiveFrom: '2027-09-01', amountCAD: 500, label: 'Full year' }],
      enabled: true,
      createdAt: makeTimestamp(now),
      createdBy: 'uid-admin',
      updatedAt: makeTimestamp(now),
      updatedBy: 'uid-admin',
    };
    mockOrderBy.mockReturnValue({
      get: vi.fn().mockResolvedValue({ docs: [{ data: () => offeringData }] }),
    });

    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);
    const body = await res.json() as { offerings: Array<{ oid: string; startDate: string; termLabel: string }> };
    expect(body.offerings).toHaveLength(1);
    expect(body.offerings[0]!.oid).toBe('bala-vihar-brampton-2027-28');
    expect(body.offerings[0]!.termLabel).toBe('2027-28');
    expect(typeof body.offerings[0]!.startDate).toBe('string');
  });

  it('serializes null endDate as null (rolling offering)', async () => {
    const now = new Date('2027-01-01T00:00:00.000Z');
    const offeringData = {
      oid: 'gita-all-spring-2026',
      programKey: 'gita',
      programLabel: 'Gita Chanting',
      location: null,
      termLabel: 'Spring 2026',
      termType: 'rolling',
      startDate: makeTimestamp(now),
      endDate: null,
      pricingTiers: [],
      enabled: true,
      createdAt: makeTimestamp(now),
      createdBy: 'uid-admin',
      updatedAt: makeTimestamp(now),
      updatedBy: 'uid-admin',
    };
    mockOrderBy.mockReturnValue({
      get: vi.fn().mockResolvedValue({ docs: [{ data: () => offeringData }] }),
    });

    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET'));
    const body = await res.json() as { offerings: Array<{ endDate: null }> };
    expect(body.offerings[0]!.endDate).toBeNull();
  });
});

// ── POST /api/admin/offerings ──────────────────────────────────────────────────

describe('POST /api/admin/offerings', () => {
  it('returns 403 for non-admin role', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin', 'family-manager'));
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('admin-required');
  });

  it('returns 401 when no x-portal-uid header', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('no-session');
  });

  it('returns 400 when body is invalid JSON', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/admin/offerings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-portal-uid': 'uid-admin', 'x-portal-role': 'admin' },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when a pricing tier amount is 0', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { ...validBody, pricingTiers: [{ effectiveFrom: '2027-09-01', amountCAD: 0, label: 'x' }] }, 'uid-admin'));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('bad-request');
  });

  it('accepts empty pricingTiers for a free program', async () => {
    const overlapGet = vi.fn().mockResolvedValue({ docs: [] });
    mockWhere.mockReturnValue({ where: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: overlapGet }) }) });

    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { ...validBody, pricingTiers: [], location: null }, 'uid-admin'));
    expect(res.status).toBe(201);
  });

  it('returns 201 with oid when no overlapping offerings exist', async () => {
    const overlapGet = vi.fn().mockResolvedValue({ docs: [] });
    mockWhere.mockReturnValue({ where: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: overlapGet }) }) });

    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(res.status).toBe(201);
    const body = await res.json() as { oid: string };
    expect(typeof body.oid).toBe('string');
    expect(body.oid).toContain('bala-vihar');
  });

  it('derives oid from programKey + location + termLabel', async () => {
    const overlapGet = vi.fn().mockResolvedValue({ docs: [] });
    mockWhere.mockReturnValue({ where: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: overlapGet }) }) });

    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { ...validBody, termLabel: 'Spring 2028' }, 'uid-admin'));
    const body = await res.json() as { oid: string };
    expect(body.oid).toBe('bala-vihar-brampton-spring-2028');
  });

  it('uses "all" for location slug when location is null', async () => {
    // location-less: no overlap query, no location in slug
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { ...validBody, location: null, termLabel: 'Spring 2028', pricingTiers: [] }, 'uid-admin'));
    const body = await res.json() as { oid: string };
    expect(body.oid).toBe('bala-vihar-all-spring-2028');
  });

  it('returns 409 when an overlapping enabled offering exists', async () => {
    const overlappingOffering = {
      oid: 'bala-vihar-brampton-2027-28-existing',
      termLabel: '2027-28 existing',
      startDate: { toDate: () => new Date('2027-08-01T00:00:00.000Z') },
      endDate: { toDate: () => new Date('2027-11-30T00:00:00.000Z') },
    };
    const overlapGet = vi.fn().mockResolvedValue({ docs: [{ id: overlappingOffering.oid, data: () => overlappingOffering }] });
    mockWhere.mockReturnValue({
      where: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: overlapGet }) }),
    });

    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; conflictOid: string };
    expect(body.error).toBe('offering-date-overlap');
    expect(body.conflictOid).toBe(overlappingOffering.oid);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 409 when create() throws ALREADY_EXISTS (code 6)', async () => {
    const overlapGet = vi.fn().mockResolvedValue({ docs: [] });
    mockWhere.mockReturnValue({ where: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: overlapGet }) }) });
    const alreadyExists = Object.assign(new Error('Document already exists'), { code: 6 });
    mockDoc.mockReturnValue({ create: vi.fn().mockRejectedValue(alreadyExists), get: mockGet });

    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; message: string; oid: string };
    expect(body.error).toBe('oid-conflict');
    expect(body.oid).toBe('bala-vihar-brampton-2027-28');
    expect(body.message).toContain('An offering already exists');
  });

  it('returns 400 invalid-term-label when termLabel produces an empty slug', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { ...validBody, termLabel: '///' }, 'uid-admin'));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid-term-label');
  });

  it('uses programLabel from getProgram', async () => {
    const overlapGet = vi.fn().mockResolvedValue({ docs: [] });
    mockWhere.mockReturnValue({ where: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: overlapGet }) }) });
    mockGetProgram.mockResolvedValue({ programKey: 'bala-vihar', label: 'Bala Vihar' });

    const createFn = vi.fn().mockResolvedValue(undefined);
    mockDoc.mockReturnValue({ create: createFn, get: mockGet });

    const { POST } = await import('../route');
    await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({ programLabel: 'Bala Vihar' }),
    );
  });

  it('falls back to programKey as programLabel when getProgram returns null', async () => {
    const overlapGet = vi.fn().mockResolvedValue({ docs: [] });
    mockWhere.mockReturnValue({ where: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: overlapGet }) }) });
    mockGetProgram.mockResolvedValue(null);

    const createFn = vi.fn().mockResolvedValue(undefined);
    mockDoc.mockReturnValue({ create: createFn, get: mockGet });

    const { POST } = await import('../route');
    await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({ programLabel: 'bala-vihar' }),
    );
  });

  it('stores termType from the request body', async () => {
    const overlapGet = vi.fn().mockResolvedValue({ docs: [] });
    mockWhere.mockReturnValue({ where: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: overlapGet }) }) });

    const createFn = vi.fn().mockResolvedValue(undefined);
    mockDoc.mockReturnValue({ create: createFn, get: mockGet });

    const { POST } = await import('../route');
    await POST(makeRequest('POST', { ...validBody, termType: 'one-time' }, 'uid-admin'));
    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({ termType: 'one-time' }),
    );
  });

  it('checks location-less offerings for overlap before creating', async () => {
    const createFn = vi.fn().mockResolvedValue(undefined);
    mockDoc.mockReturnValue({ create: createFn, get: mockGet });

    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { ...validBody, location: null, pricingTiers: [] }, 'uid-admin'));
    expect(res.status).toBe(201);
    expect(mockWhere).toHaveBeenCalledWith('location', '==', null);
  });

  it('revalidates offerings tag on success', async () => {
    const overlapGet = vi.fn().mockResolvedValue({ docs: [] });
    mockWhere.mockReturnValue({ where: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: overlapGet }) }) });
    const { revalidateTag } = await import('next/cache');
    const { POST } = await import('../route');
    await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(revalidateTag).toHaveBeenCalledWith('offerings', 'max');
  });
});
