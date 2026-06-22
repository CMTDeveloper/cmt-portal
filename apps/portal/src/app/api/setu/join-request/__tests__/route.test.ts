import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

const mockList = vi.fn();
vi.mock('@/features/setu/join-request/list-requests', () => ({
  listPendingJoinRequests: (...args: unknown[]) => mockList(...args),
}));

import { GET } from '../route';

function makeRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/setu/join-request', { headers });
}

function managerHeaders(fid = 'F1'): Record<string, string> {
  return { 'x-portal-role': 'family-manager', 'x-portal-fid': fid };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/setu/join-request (manager list)', () => {
  it('401 when no role', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('403 when not manager', async () => {
    const res = await GET(makeRequest({ 'x-portal-role': 'family-member', 'x-portal-fid': 'F1' }));
    expect(res.status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('400 when fid missing', async () => {
    const res = await GET(makeRequest({ 'x-portal-role': 'family-manager' }));
    expect(res.status).toBe(400);
  });

  it('happy path: lists pending requests for claims.fid', async () => {
    const requests = [
      { token: 't1', requesterEmail: 'a@b.com', matchedMid: 'F1-02', createdAt: '2026-06-22T00:00:00.000Z', status: 'pending' },
    ];
    mockList.mockResolvedValue(requests);
    const res = await GET(makeRequest(managerHeaders('F1')));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requests });
    expect(mockList).toHaveBeenCalledWith('F1');
  });
});
