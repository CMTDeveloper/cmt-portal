import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

const mockApprove = vi.fn();
vi.mock('@/features/setu/join-request/approve-request', () => ({
  approveJoinRequest: (...args: unknown[]) => mockApprove(...args),
}));

import { POST } from '../route';

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/setu/join-request/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function managerHeaders(fid = 'F1'): Record<string, string> {
  return { 'x-portal-role': 'family-manager', 'x-portal-fid': fid, 'x-portal-mid': `${fid}-01` };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/setu/join-request/approve', () => {
  it('401 when no role', async () => {
    const res = await POST(makeRequest({ token: 't' }));
    expect(res.status).toBe(401);
  });

  it('403 when role is family-member (not manager)', async () => {
    const res = await POST(makeRequest({ token: 't' }, { 'x-portal-role': 'family-member', 'x-portal-fid': 'F1' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('manager-required');
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it('400 when token missing', async () => {
    const res = await POST(makeRequest({}, managerHeaders()));
    expect(res.status).toBe(400);
  });

  it('happy path: promotes + returns {ok:true}, passes managerFid from claims', async () => {
    mockApprove.mockResolvedValue({ ok: true, matchedMid: 'F1-02' });
    const res = await POST(makeRequest({ token: 'tok' }, managerHeaders('F1')));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockApprove).toHaveBeenCalledWith({ token: 'tok', managerFid: 'F1' });
  });

  it('403 forbidden on fid-mismatch from the helper', async () => {
    mockApprove.mockResolvedValue({ error: 'fid-mismatch' });
    const res = await POST(makeRequest({ token: 'tok' }, managerHeaders('F1')));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('forbidden');
  });

  it('404 on not-found', async () => {
    mockApprove.mockResolvedValue({ error: 'not-found' });
    const res = await POST(makeRequest({ token: 'tok' }, managerHeaders()));
    expect(res.status).toBe(404);
  });

  it('409 already-resolved', async () => {
    mockApprove.mockResolvedValue({ error: 'already-resolved' });
    const res = await POST(makeRequest({ token: 'tok' }, managerHeaders()));
    expect(res.status).toBe(409);
  });

  it('409 contact-already-registered on contact-conflict', async () => {
    mockApprove.mockResolvedValue({ error: 'contact-conflict' });
    const res = await POST(makeRequest({ token: 'tok' }, managerHeaders()));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('contact-already-registered');
  });
});
