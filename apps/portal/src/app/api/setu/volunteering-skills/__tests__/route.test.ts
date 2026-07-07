import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/volunteering-skills', () => ({
  getVolunteeringSkillOptions: vi.fn(),
}));

import { GET } from '../route';
import { getVolunteeringSkillOptions } from '@/lib/volunteering-skills';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/setu/volunteering-skills', () => {
  it('returns the admin-managed options publicly — no session (the register form is pre-auth)', async () => {
    vi.mocked(getVolunteeringSkillOptions).mockResolvedValue(['Teaching', 'AV / Tech']);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { options: string[] };
    expect(body.options).toEqual(['Teaching', 'AV / Tech']);
  });
});
