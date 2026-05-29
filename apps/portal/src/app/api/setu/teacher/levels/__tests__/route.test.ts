import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetMyLevels } = vi.hoisted(() => ({ mockGetMyLevels: vi.fn() }));
vi.mock('@/features/setu/teacher/levels', () => ({ getMyLevels: mockGetMyLevels }));

function makeRequest(role: string, mid?: string, extraRoles?: string): Request {
  const headers: Record<string, string> = { 'x-portal-role': role, 'x-portal-uid': 'uid-x' };
  if (mid) headers['x-portal-mid'] = mid;
  if (extraRoles) headers['x-portal-extra-roles'] = extraRoles;
  return new Request('http://localhost/api/setu/teacher/levels', { method: 'GET', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMyLevels.mockResolvedValue([]);
});

describe('GET /api/setu/teacher/levels', () => {
  it('returns 403 for a non-teacher family-manager', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('family-manager', 'CMT-FAM1-01'));
    expect(res.status).toBe(403);
  });

  it('allows a parent-teacher (extraRoles=teacher) and queries by mid', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('family-manager', 'CMT-FAM1-01', 'teacher'));
    expect(res.status).toBe(200);
    expect(mockGetMyLevels).toHaveBeenCalledWith('CMT-FAM1-01');
  });

  it('allows a teacher-only role', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('teacher', 'CMT-FAM1-01'));
    expect(res.status).toBe(200);
  });

  it('allows admin (inherits teacher)', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('admin'));
    expect(res.status).toBe(200);
  });

  it('serializes level timestamps to ISO', async () => {
    const now = new Date('2025-09-01T00:00:00.000Z');
    mockGetMyLevels.mockResolvedValue([
      { levelId: 'l1', levelName: 'Level 2', createdAt: now, updatedAt: now },
    ]);
    const { GET } = await import('../route');
    const res = await GET(makeRequest('teacher', 'CMT-FAM1-01'));
    const body = await res.json();
    expect(body.levels[0].levelId).toBe('l1');
    expect(typeof body.levels[0].createdAt).toBe('string');
  });
});
