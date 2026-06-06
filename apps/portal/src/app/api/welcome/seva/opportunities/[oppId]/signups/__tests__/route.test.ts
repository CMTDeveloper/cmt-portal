import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/setu/seva/get-opportunity-roster', () => ({ getOpportunityRoster: vi.fn() }));

import { GET } from '../route';
import { getOpportunityRoster } from '@/features/setu/seva/get-opportunity-roster';

function req(role: string | null = 'welcome-team', uid: string | null = 'w1'): Request {
  const headers: Record<string, string> = {};
  if (role) headers['x-portal-role'] = role;
  if (uid) headers['x-portal-uid'] = uid;
  return new Request('http://localhost/api/welcome/seva/opportunities/o1/signups', { method: 'GET', headers });
}
const ctx = { params: Promise.resolve({ oppId: 'o1' }) };
const roster = { opportunity: { oppId: 'o1' }, rows: [{ signupId: 'o1__F1' }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOpportunityRoster).mockResolvedValue(roster as never);
});

describe('GET /api/welcome/seva/opportunities/[oppId]/signups', () => {
  it('401 when no session', async () => {
    expect((await GET(req(null, null), ctx)).status).toBe(401);
  });
  it('403 when role is family-member', async () => {
    expect((await GET(req('family-member'), ctx)).status).toBe(403);
  });
  it('404 when roster resolves null', async () => {
    vi.mocked(getOpportunityRoster).mockResolvedValue(null);
    expect((await GET(req('welcome-team'), ctx)).status).toBe(404);
  });
  it('200 returns { opportunity, rows } for welcome-team', async () => {
    const res = await GET(req('welcome-team'), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(roster);
  });
  it('200 also for admin (inherits welcome-team)', async () => {
    const res = await GET(req('admin'), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(roster);
  });
});
