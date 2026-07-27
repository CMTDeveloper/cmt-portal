import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFlags, mockFinalize } = vi.hoisted(() => ({
  mockFlags: { setuPledge: true },
  mockFinalize: vi.fn(),
}));
vi.mock('@/lib/flags', () => ({ flags: mockFlags }));
vi.mock('@/features/setu/pledges/finalize-pledge', () => ({ finalizePledge: mockFinalize }));

import { POST } from '../route';

const MANAGER = { 'x-portal-role': 'family-manager', 'x-portal-fid': 'CMT-A', 'x-portal-mid': 'CMT-A-01' };
function req(headers: Record<string, string>, body: unknown) {
  return new Request('https://portal.test/api/pledges/finalize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockFlags.setuPledge = true;
  mockFinalize.mockReset();
  mockFinalize.mockResolvedValue({ state: 'active' });
});

describe('POST /api/pledges/finalize', () => {
  it('returns the provider-derived state', async () => {
    const res = await POST(req(MANAGER, { pid: 'PLG-1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'active' });
  });

  it('REJECTS an extra body key rather than ignoring it', async () => {
    // .strict() so a caller cannot post `status: 'active'` and have it silently
    // dropped - the 400 makes an attempt to steer the outcome visible.
    const res = await POST(req(MANAGER, { pid: 'PLG-1', status: 'active' }));
    expect(res.status).toBe(400);
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  it('passes the SESSION fid, never anything from the body', async () => {
    await POST(req(MANAGER, { pid: 'PLG-1' }));
    expect(mockFinalize).toHaveBeenCalledWith({ pid: 'PLG-1', fid: 'CMT-A' });
  });

  it('404s when the feature is dark', async () => {
    mockFlags.setuPledge = false;
    expect((await POST(req(MANAGER, { pid: 'PLG-1' }))).status).toBe(404);
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  it('403s a non-manager', async () => {
    const res = await POST(req({ ...MANAGER, 'x-portal-role': 'family-member' }, { pid: 'PLG-1' }));
    expect(res.status).toBe(403);
  });

  it("reports another family's pledge as 404, not 403", async () => {
    // A 403 would confirm the pid exists. Not-yours and not-found must be
    // indistinguishable to a caller probing ids.
    mockFinalize.mockResolvedValue({ state: 'not-yours' });
    const res = await POST(req(MANAGER, { pid: 'PLG-SOMEONE-ELSE' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
  });

  it('surfaces processing WITHOUT claiming success', async () => {
    mockFinalize.mockResolvedValue({ state: 'processing' });
    const res = await POST(req(MANAGER, { pid: 'PLG-1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'processing' });
  });

  it('503s on a provider failure without echoing it', async () => {
    mockFinalize.mockRejectedValue(new Error('stripe says cus_123 declined'));
    const res = await POST(req(MANAGER, { pid: 'PLG-1' }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('cus_123');
  });
});
