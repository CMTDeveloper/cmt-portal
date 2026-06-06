import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/setu/seva/get-seva-compliance', () => ({ getSevaCompliance: vi.fn() }));

import { GET } from '../route';
import { getSevaCompliance } from '@/features/setu/seva/get-seva-compliance';

function req(role: string | null = 'welcome-team', uid: string | null = 'w1'): Request {
  const headers: Record<string, string> = {};
  if (role) headers['x-portal-role'] = role;
  if (uid) headers['x-portal-uid'] = uid;
  return new Request('http://localhost/api/welcome/seva/compliance', { method: 'GET', headers });
}

const compliance = {
  currentSevaYear: '2025-26',
  hoursPerYear: 5,
  rows: [{ fid: 'F1', name: 'Sharma', hoursEarned: 7, met: true }],
  summary: { totalFamilies: 1, metCount: 1, shortCount: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSevaCompliance).mockResolvedValue(compliance);
});

describe('GET /api/welcome/seva/compliance', () => {
  it('401 when no session', async () => {
    expect((await GET(req(null, null))).status).toBe(401);
  });
  it('403 when role is family-member', async () => {
    expect((await GET(req('family-member'))).status).toBe(403);
  });
  it('200 returns the compliance object for welcome-team', async () => {
    const res = await GET(req('welcome-team'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(compliance);
  });
  it('200 also for admin (inherits welcome-team)', async () => {
    const res = await GET(req('admin'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(compliance);
  });
});
