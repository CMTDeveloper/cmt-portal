import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

const mockGet = vi.fn();
vi.mock('@/features/setu/join-request/get-by-token', () => ({
  getJoinRequestByToken: (...args: unknown[]) => mockGet(...args),
}));

import { GET } from '../route';

function makeRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/setu/join-request/tok', { headers });
}

function managerHeaders(fid = 'F1'): Record<string, string> {
  return { 'x-portal-role': 'family-manager', 'x-portal-fid': fid };
}

const params = Promise.resolve({ token: 'tok' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/setu/join-request/[token]', () => {
  it('401 when no role', async () => {
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(401);
  });

  it('403 when not manager', async () => {
    const res = await GET(makeRequest({ 'x-portal-role': 'family-member', 'x-portal-fid': 'F1' }), { params });
    expect(res.status).toBe(403);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('404 when not found', async () => {
    mockGet.mockResolvedValue({ error: 'not-found' });
    const res = await GET(makeRequest(managerHeaders()), { params });
    expect(res.status).toBe(404);
  });

  it('404 when the request belongs to another family', async () => {
    mockGet.mockResolvedValue({
      token: 'tok', fid: 'F2', requesterEmail: 'a@b.com', familyName: 'Other',
      status: 'pending', expiresAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    const res = await GET(makeRequest(managerHeaders('F1')), { params });
    expect(res.status).toBe(404);
  });

  it('happy path: returns metadata for the manager\'s own family', async () => {
    mockGet.mockResolvedValue({
      token: 'tok', fid: 'F1', requesterName: 'Asha Sharma', requesterEmail: 'asha@example.com',
      familyName: 'Sharma Family', status: 'pending', expiresAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    const res = await GET(makeRequest(managerHeaders('F1')), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      token: 'tok',
      requesterName: 'Asha Sharma',
      requesterEmail: 'asha@example.com',
      familyName: 'Sharma Family',
      status: 'pending',
      expiresAt: '2026-07-01T00:00:00.000Z',
    });
  });
});
