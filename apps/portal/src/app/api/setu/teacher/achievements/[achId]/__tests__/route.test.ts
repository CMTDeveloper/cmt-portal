import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCanSee, mockRevoke } = vi.hoisted(() => ({ mockCanSee: vi.fn(), mockRevoke: vi.fn() }));
vi.mock('@/features/setu/teacher/student-detail', () => ({ canTeacherSeeStudent: mockCanSee }));
vi.mock('@/features/setu/teacher/award-achievement', () => ({ revokeAchievement: mockRevoke }));

function req(role: string | null, mid?: string): Request {
  const headers: Record<string, string> = {};
  if (role) { headers['x-portal-role'] = role; headers['x-portal-uid'] = 'uid-teacher'; headers['x-portal-mid'] = 'CMT-A-01'; }
  const url = `http://localhost/api/setu/teacher/achievements/a1${mid ? `?mid=${encodeURIComponent(mid)}` : ''}`;
  return new Request(url, { method: 'DELETE', headers });
}
const ctx = { params: Promise.resolve({ achId: 'a1' }) };

beforeEach(() => { vi.clearAllMocks(); mockCanSee.mockResolvedValue(true); mockRevoke.mockResolvedValue(true); });

describe('DELETE achievements/[achId]', () => {
  it('403 for a non-teacher', async () => {
    const { DELETE } = await import('../route');
    expect((await DELETE(req('family-manager', 'CMT-F1-02'), ctx)).status).toBe(403);
  });
  it('400 when mid query param is missing', async () => {
    const { DELETE } = await import('../route');
    expect((await DELETE(req('teacher'), ctx)).status).toBe(400);
  });
  it('403 not-your-student when roster check fails', async () => {
    mockCanSee.mockResolvedValue(false);
    const { DELETE } = await import('../route');
    expect((await DELETE(req('teacher', 'CMT-F1-02'), ctx)).status).toBe(403);
    expect(mockRevoke).not.toHaveBeenCalled();
  });
  it('404 when the achievement does not exist', async () => {
    mockRevoke.mockResolvedValue(false);
    const { DELETE } = await import('../route');
    expect((await DELETE(req('teacher', 'CMT-F1-02'), ctx)).status).toBe(404);
  });
  it('200 revokes for fid derived from mid', async () => {
    const { DELETE } = await import('../route');
    const res = await DELETE(req('teacher', 'CMT-F1-02'), ctx);
    expect(res.status).toBe(200);
    expect(mockRevoke).toHaveBeenCalledWith('CMT-F1', 'CMT-F1-02', 'a1');
  });
});
