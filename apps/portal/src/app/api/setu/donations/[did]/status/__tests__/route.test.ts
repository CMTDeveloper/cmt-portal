import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

const mockMark = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/donations/mark-donation-status', () => ({
  markDonationStatus: mockMark,
}));

import { POST } from '../route';

function makeRequest(
  did: string,
  body: unknown,
  session?: { role: string; fid: string; mid: string },
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (session) {
    headers.set('x-portal-role', session.role);
    headers.set('x-portal-fid', session.fid);
    headers.set('x-portal-mid', session.mid);
  }
  const req = new Request(`http://localhost/api/setu/donations/${did}/status`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { req, ctx: { params: Promise.resolve({ did }) } };
}

const MANAGER = { role: 'family-manager', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-01' };

beforeEach(() => {
  vi.clearAllMocks();
  mockMark.mockResolvedValue(true);
});

describe('POST /api/setu/donations/[did]/status', () => {
  it('returns 403 for a non-manager family member', async () => {
    const { req, ctx } = makeRequest('don-1', { status: 'completed' }, {
      role: 'family-member',
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(403);
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('returns 403 when no session', async () => {
    const { req, ctx } = makeRequest('don-1', { status: 'completed' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(403);
  });

  it('rejects an invalid status (cannot set redirected)', async () => {
    const { req, ctx } = makeRequest('don-1', { status: 'redirected' }, MANAGER);
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('marks completed and passes the caller fid to the guard', async () => {
    const { req, ctx } = makeRequest('don-1', { status: 'completed' }, MANAGER);
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, status: 'completed' });
    expect(mockMark).toHaveBeenCalledWith('don-1', 'CMT-AB12CD34', 'completed');
  });

  it('returns 404 when the donation is unknown or belongs to another family', async () => {
    mockMark.mockResolvedValue(false);
    const { req, ctx } = makeRequest('don-x', { status: 'abandoned' }, MANAGER);
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const { req, ctx } = makeRequest('don-1', { status: 'completed' }, MANAGER);
    const res = await flaggedPOST(req, ctx);
    expect(res.status).toBe(404);
  });
});
