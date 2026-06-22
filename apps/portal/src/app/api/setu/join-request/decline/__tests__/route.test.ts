import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

const mockDecline = vi.fn();
vi.mock('@/features/setu/join-request/decline-request', () => ({
  declineJoinRequest: (...args: unknown[]) => mockDecline(...args),
}));

import { POST } from '../route';

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/setu/join-request/decline', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function managerHeaders(fid = 'F1'): Record<string, string> {
  return { 'x-portal-role': 'family-manager', 'x-portal-fid': fid };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/setu/join-request/decline', () => {
  it('401 when no role', async () => {
    const res = await POST(makeRequest({ token: 't' }));
    expect(res.status).toBe(401);
  });

  it('403 when not manager', async () => {
    const res = await POST(makeRequest({ token: 't' }, { 'x-portal-role': 'family-member', 'x-portal-fid': 'F1' }));
    expect(res.status).toBe(403);
    expect(mockDecline).not.toHaveBeenCalled();
  });

  it('happy path: marks declined, returns {ok:true} with claims fid', async () => {
    mockDecline.mockResolvedValue({ ok: true });
    const res = await POST(makeRequest({ token: 'tok' }, managerHeaders('F1')));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockDecline).toHaveBeenCalledWith({ token: 'tok', managerFid: 'F1' });
  });

  it('403 forbidden on fid-mismatch', async () => {
    mockDecline.mockResolvedValue({ error: 'fid-mismatch' });
    const res = await POST(makeRequest({ token: 'tok' }, managerHeaders()));
    expect(res.status).toBe(403);
  });

  it('409 already-resolved', async () => {
    mockDecline.mockResolvedValue({ error: 'already-resolved' });
    const res = await POST(makeRequest({ token: 'tok' }, managerHeaders()));
    expect(res.status).toBe(409);
  });
});
