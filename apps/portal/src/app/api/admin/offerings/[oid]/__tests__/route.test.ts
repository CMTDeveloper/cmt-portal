import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockOfferingRef = { get: mockGet, update: mockUpdate };
const mockOverlapGet = vi.fn();
const mockWhere = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const Timestamp = { fromDate: (d: Date) => ({ toDate: () => d }) };
  const FieldValue = { serverTimestamp: () => 'SERVER_TS' };
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

const existingOfferingData = {
  oid: 'bala-vihar-brampton-2027-28',
  programKey: 'bala-vihar',
  location: 'Brampton',
  termLabel: '2027-28',
  termType: 'term',
  startDate: { toDate: () => new Date(FUTURE_START) },
  endDate: { toDate: () => new Date(FUTURE_END) },
  pricingTiers: [{ effectiveFrom: '2027-09-01', amountCAD: 500, label: 'Full year' }],
  enabled: true,
};

function makeRequest(oid: string, body?: unknown, uid?: string, role = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-portal-role': role };
  if (uid) headers['x-portal-uid'] = uid;
  return new Request(`http://localhost/api/admin/offerings/${oid}`, {
    method: 'PATCH',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWhere.mockReturnThis();
  mockDoc.mockReturnValue(mockOfferingRef);
  mockCollection.mockReturnValue({
    doc: mockDoc,
    where: mockWhere,
    get: mockOverlapGet,
  });
  mockGet.mockResolvedValue({ exists: true, data: () => existingOfferingData });
  mockOverlapGet.mockResolvedValue({ docs: [] });
  mockUpdate.mockResolvedValue(undefined);
});

describe('PATCH /api/admin/offerings/[oid]', () => {
  it('returns 403 for non-admin role', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-2027-28', { enabled: false }, 'uid-admin', 'family-manager'),
      { params: Promise.resolve({ oid: 'bala-vihar-brampton-2027-28' }) },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('admin-required');
  });

  it('returns 401 when no x-portal-uid header', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('bala-vihar-brampton-2027-28', { enabled: false }), {
      params: Promise.resolve({ oid: 'bala-vihar-brampton-2027-28' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('no-session');
  });

  it('returns 404 when offering does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('nonexistent-oid', { enabled: false }, 'uid-admin'),
      { params: Promise.resolve({ oid: 'nonexistent-oid' }) },
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not-found');
  });

  it('returns 400 when body is invalid JSON', async () => {
    const { PATCH } = await import('../route');
    const req = new Request('http://localhost/api/admin/offerings/test-oid', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-portal-uid': 'uid-admin', 'x-portal-role': 'admin' },
      body: 'not-json',
    });
    const res = await PATCH(req, { params: Promise.resolve({ oid: 'test-oid' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a pricing tier amount is 0', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-2027-28', { pricingTiers: [{ effectiveFrom: '2027-09-01', amountCAD: 0, label: 'x' }] }, 'uid-admin'),
      { params: Promise.resolve({ oid: 'bala-vihar-brampton-2027-28' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when both dates provided and endDate before startDate', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-2027-28', { startDate: FUTURE_END, endDate: FUTURE_START }, 'uid-admin'),
      { params: Promise.resolve({ oid: 'bala-vihar-brampton-2027-28' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when new endDate is before existing startDate', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-2027-28', { endDate: '2027-01-01T00:00:00.000Z' }, 'uid-admin'),
      { params: Promise.resolve({ oid: 'bala-vihar-brampton-2027-28' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 with oid on valid partial update (enabled toggle)', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-2027-28', { enabled: false }, 'uid-admin'),
      { params: Promise.resolve({ oid: 'bala-vihar-brampton-2027-28' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { oid: string };
    expect(body.oid).toBe('bala-vihar-brampton-2027-28');
  });

  it('returns 409 when enabling would overlap another enabled offering', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ ...existingOfferingData, enabled: false }),
    });
    mockOverlapGet.mockResolvedValue({
      docs: [{
        id: 'bala-vihar-brampton-2027-28-overlap',
        data: () => ({
          oid: 'bala-vihar-brampton-2027-28-overlap',
          termLabel: 'Overlapping term',
          startDate: { toDate: () => new Date('2027-08-01T00:00:00.000Z') },
          endDate: { toDate: () => new Date('2027-11-30T00:00:00.000Z') },
        }),
      }],
    });

    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-2027-28', { enabled: true }, 'uid-admin'),
      { params: Promise.resolve({ oid: 'bala-vihar-brampton-2027-28' }) },
    );

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; conflictOid: string };
    expect(body.error).toBe('offering-date-overlap');
    expect(body.conflictOid).toBe('bala-vihar-brampton-2027-28-overlap');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 200 on valid pricingTiers update', async () => {
    const { PATCH } = await import('../route');
    const newTiers = [{ effectiveFrom: '2027-09-01', amountCAD: 750, label: 'Full year' }];
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-2027-28', { pricingTiers: newTiers }, 'uid-admin'),
      { params: Promise.resolve({ oid: 'bala-vihar-brampton-2027-28' }) },
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledOnce();
    const updateArg = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(updateArg['pricingTiers']).toEqual(newTiers);
    expect(updateArg['updatedBy']).toBe('uid-admin');
  });

  it('returns 200 on valid termLabel update', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-2027-28', { termLabel: 'Fall 2027' }, 'uid-admin'),
      { params: Promise.resolve({ oid: 'bala-vihar-brampton-2027-28' }) },
    );
    expect(res.status).toBe(200);
    const updateArg = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(updateArg['termLabel']).toBe('Fall 2027');
  });

  it('returns 200 on valid amountTiers update', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-2027-28', { amountTiers: [600, 900, 1200] }, 'uid-admin'),
      { params: Promise.resolve({ oid: 'bala-vihar-brampton-2027-28' }) },
    );
    expect(res.status).toBe(200);
    const updateArg = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(updateArg['amountTiers']).toEqual([600, 900, 1200]);
  });

  it('does not write fields not present in update body', async () => {
    const { PATCH } = await import('../route');
    await PATCH(
      makeRequest('bala-vihar-brampton-2027-28', { enabled: false }, 'uid-admin'),
      { params: Promise.resolve({ oid: 'bala-vihar-brampton-2027-28' }) },
    );
    const updateArg = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect('pricingTiers' in updateArg).toBe(false);
    expect('amountTiers' in updateArg).toBe(false);
    expect('termLabel' in updateArg).toBe(false);
  });

  it('revalidates offerings tag on success', async () => {
    const { revalidateTag } = await import('next/cache');
    const { PATCH } = await import('../route');
    await PATCH(
      makeRequest('bala-vihar-brampton-2027-28', { enabled: false }, 'uid-admin'),
      { params: Promise.resolve({ oid: 'bala-vihar-brampton-2027-28' }) },
    );
    expect(revalidateTag).toHaveBeenCalledWith('offerings', 'max');
  });
});
