import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/setu/members/get-child-profile', () => ({ getChildProfile: vi.fn() }));

import { GET } from '../route';
import { getChildProfile } from '@/features/setu/members/get-child-profile';

function req(role: string | null = 'family-member', fid: string | null = 'CMT-FAM1'): Request {
  const headers: Record<string, string> = {};
  if (role) headers['x-portal-role'] = role;
  if (fid) headers['x-portal-fid'] = fid;
  return new Request('http://localhost/api/setu/members/CMT-FAM1-03/profile', { headers });
}
const ctx = { params: Promise.resolve({ mid: 'CMT-FAM1-03' }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/setu/members/[mid]/profile', () => {
  it('401 when no session', async () => {
    const res = await GET(req(null, null), ctx);
    expect(res.status).toBe(401);
  });

  it('404 when getChildProfile resolves null', async () => {
    vi.mocked(getChildProfile).mockResolvedValue(null);
    const res = await GET(req('family-member', 'CMT-FAM1'), ctx);
    expect(res.status).toBe(404);
  });

  it('200 with body { profile } for a family reading its own child', async () => {
    const profile = { mid: 'CMT-FAM1-03', fid: 'CMT-FAM1' };
    vi.mocked(getChildProfile).mockResolvedValue(profile as never);
    const res = await GET(req('family-member', 'CMT-FAM1'), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profile });
  });

  it('404 (no leak) when a family reads another family child', async () => {
    vi.mocked(getChildProfile).mockResolvedValue({ fid: 'CMT-FAM1' } as never);
    const res = await GET(req('family-member', 'CMT-OTHER'), ctx);
    expect(res.status).toBe(404);
  });

  it('200 when welcome-team reads any family child', async () => {
    const profile = { fid: 'CMT-FAM1' };
    vi.mocked(getChildProfile).mockResolvedValue(profile as never);
    const res = await GET(req('welcome-team', null), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profile });
  });
});
