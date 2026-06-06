import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/features/setu/seva/get-family-seva-view', () => ({ getFamilySevaView: vi.fn() }));
import { GET } from '../route';
import { getFamilySevaView } from '@/features/setu/seva/get-family-seva-view';

function req(role: string | null = 'family-member', fid: string | null = 'CMT-AB12CD34'): Request {
  const headers: Record<string, string> = {};
  if (role) headers['x-portal-role'] = role;
  if (fid) headers['x-portal-fid'] = fid;
  return new Request('http://localhost/api/setu/seva/my', { method: 'GET', headers });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFamilySevaView).mockResolvedValue({ currentSevaYear: '2025-26', hoursPerYear: 20, opportunities: [], mySignups: [{ signupId: 's1' }] } as never);
});
describe('GET /api/setu/seva/my', () => {
  it('401 without a session', async () => {
    expect((await GET(req(null, null))).status).toBe(401);
  });
  it('200 returns mySignups', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).mySignups).toEqual([{ signupId: 's1' }]);
  });
  it('200 empty when no fid', async () => {
    const res = await GET(req('family', null));
    expect(res.status).toBe(200);
    expect((await res.json()).mySignups).toEqual([]);
    expect(getFamilySevaView).not.toHaveBeenCalled();
  });
});
