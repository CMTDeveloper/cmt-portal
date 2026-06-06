import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/volunteering-skills', () => ({
  getVolunteeringSkillOptions: vi.fn(),
}));

import { GET } from '../route';
import { getVolunteeringSkillOptions } from '@/lib/volunteering-skills';

function req(role?: string): Request {
  const headers: Record<string, string> = {};
  if (role) headers['x-portal-role'] = role;
  return new Request('http://localhost/api/setu/volunteering-skills', { method: 'GET', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/setu/volunteering-skills', () => {
  it('returns 401 when there is no session', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('returns the options for a signed-in family member', async () => {
    vi.mocked(getVolunteeringSkillOptions).mockResolvedValue(['Teaching', 'AV / Tech']);
    const res = await GET(req('family-member'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { options: string[] };
    expect(body.options).toEqual(['Teaching', 'AV / Tech']);
  });
});
