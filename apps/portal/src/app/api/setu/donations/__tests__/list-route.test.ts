import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

const mockGetDonations = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/donations/get-donations', () => ({
  getDonations: mockGetDonations,
}));

import { GET } from '../route';

const donation = {
  did: 'don-1',
  fid: 'CMT-AB12CD34',
  donorMid: 'CMT-AB12CD34-01',
  donorName: 'Raj Patel',
  donorEmail: 'raj@example.com',
  type: 'enrollment',
  programKey: 'bala-vihar',
  programLabel: 'Bala Vihar',
  pid: 'oid-1',
  eid: 'CMT-AB12CD34-oid-1',
  label: 'Bala Vihar Donation — 2025-26',
  amountCAD: 200,
  coverFee: false,
  feeCAD: 0,
  clientReferenceId: 'don-1',
  status: 'completed',
  createdAt: new Date('2026-01-04T10:00:00Z'),
  updatedAt: new Date('2026-01-04T10:05:00Z'),
};

function makeRequest(session?: { role: string; fid: string; mid: string }) {
  const headers = new Headers();
  if (session) {
    headers.set('x-portal-role', session.role);
    headers.set('x-portal-fid', session.fid);
    headers.set('x-portal-mid', session.mid);
  }
  return new Request('http://localhost/api/setu/donations', { method: 'GET', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDonations.mockResolvedValue([donation]);
});

describe('GET /api/setu/donations', () => {
  it('returns 401 when no session headers', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns the family donations for any family role (member), ISO dates', async () => {
    const res = await GET(makeRequest({ role: 'family-member', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-02' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.donations).toHaveLength(1);
    expect(body.donations[0].did).toBe('don-1');
    expect(body.donations[0].createdAt).toBe('2026-01-04T10:00:00.000Z');
    expect(mockGetDonations).toHaveBeenCalledWith('CMT-AB12CD34');
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { GET: flaggedGET } = await import('../route');
    const res = await flaggedGET(makeRequest({ role: 'family-manager', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-01' }));
    expect(res.status).toBe(404);
  });
});
