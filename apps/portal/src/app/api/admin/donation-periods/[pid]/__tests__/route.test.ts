import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockPeriodRef = { get: mockGet, update: mockUpdate };

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const Timestamp = {
    fromDate: (d: Date) => ({ toDate: () => d }),
  };
  const FieldValue = {
    serverTimestamp: () => 'SERVER_TS',
  };
  return {
    Timestamp,
    FieldValue,
    portalFirestore: vi.fn(() => ({
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue(mockPeriodRef),
      }),
    })),
  };
});

const FUTURE_START = '2027-09-01T04:00:00.000Z';
const FUTURE_END = '2027-12-31T04:59:59.000Z';

// Firestore returns Timestamp objects, not plain Dates — tests M1 fix
const existingPeriodData = {
  pid: 'bala-vihar-brampton-fall-2027',
  startDate: { toDate: () => new Date(FUTURE_START) },
  endDate: { toDate: () => new Date(FUTURE_END) },
  suggestedAmount: 500,
  enabled: true,
};

function makeRequest(pid: string, body?: unknown, uid?: string, role = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-portal-role': role };
  if (uid) headers['x-portal-uid'] = uid;
  return new Request(`http://localhost/api/admin/donation-periods/${pid}`, {
    method: 'PATCH',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ exists: true, data: () => existingPeriodData });
  mockUpdate.mockResolvedValue(undefined);
});

describe('PATCH /api/admin/donation-periods/[pid]', () => {
  it('returns 403 for non-admin role (H1)', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-fall-2027', { enabled: false }, 'uid-admin', 'family-manager'),
      { params: Promise.resolve({ pid: 'bala-vihar-brampton-fall-2027' }) },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('forbidden');
  });

  it('returns 401 when no x-portal-uid header', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('bala-vihar-brampton-fall-2027', { enabled: false }), {
      params: Promise.resolve({ pid: 'bala-vihar-brampton-fall-2027' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('no-session');
  });

  it('returns 404 when period does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('nonexistent-pid', { enabled: false }, 'uid-admin'),
      { params: Promise.resolve({ pid: 'nonexistent-pid' }) },
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not-found');
  });

  it('returns 400 when body is invalid JSON', async () => {
    const { PATCH } = await import('../route');
    const req = new Request('http://localhost/api/admin/donation-periods/test-pid', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-portal-uid': 'uid-admin', 'x-portal-role': 'admin' },
      body: 'not-json',
    });
    const res = await PATCH(req, { params: Promise.resolve({ pid: 'test-pid' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when suggestedAmount is 0', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-fall-2027', { suggestedAmount: 0 }, 'uid-admin'),
      { params: Promise.resolve({ pid: 'bala-vihar-brampton-fall-2027' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when both dates provided and endDate before startDate', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest(
        'bala-vihar-brampton-fall-2027',
        { startDate: FUTURE_END, endDate: FUTURE_START },
        'uid-admin',
      ),
      { params: Promise.resolve({ pid: 'bala-vihar-brampton-fall-2027' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when new endDate is before existing startDate', async () => {
    // Existing startDate is FUTURE_START (2027-09-01). New endDate is 2027-01-01 — before it.
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest(
        'bala-vihar-brampton-fall-2027',
        { endDate: '2027-01-01T00:00:00.000Z' },
        'uid-admin',
      ),
      { params: Promise.resolve({ pid: 'bala-vihar-brampton-fall-2027' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 with pid on valid partial update (enabled toggle)', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-fall-2027', { enabled: false }, 'uid-admin'),
      { params: Promise.resolve({ pid: 'bala-vihar-brampton-fall-2027' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { pid: string };
    expect(body.pid).toBe('bala-vihar-brampton-fall-2027');
  });

  it('returns 200 on valid suggestedAmount update', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-fall-2027', { suggestedAmount: 750 }, 'uid-admin'),
      { params: Promise.resolve({ pid: 'bala-vihar-brampton-fall-2027' }) },
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledOnce();
    const updateArg = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(updateArg['suggestedAmount']).toBe(750);
    expect(updateArg['updatedBy']).toBe('uid-admin');
  });

  it('returns 200 on valid amountTiers update and writes correct value', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('bala-vihar-brampton-fall-2027', { amountTiers: [600, 900, 1200] }, 'uid-admin'),
      { params: Promise.resolve({ pid: 'bala-vihar-brampton-fall-2027' }) },
    );
    expect(res.status).toBe(200);
    const updateArg = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(updateArg['amountTiers']).toEqual([600, 900, 1200]);
  });

  it('does not write fields not present in update body', async () => {
    const { PATCH } = await import('../route');
    await PATCH(
      makeRequest('bala-vihar-brampton-fall-2027', { enabled: false }, 'uid-admin'),
      { params: Promise.resolve({ pid: 'bala-vihar-brampton-fall-2027' }) },
    );
    const updateArg = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect('suggestedAmount' in updateArg).toBe(false);
    expect('amountTiers' in updateArg).toBe(false);
    expect('periodLabel' in updateArg).toBe(false);
  });
});
