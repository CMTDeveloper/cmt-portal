import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCanSee, mockAward } = vi.hoisted(() => ({ mockCanSee: vi.fn(), mockAward: vi.fn() }));
vi.mock('@/features/setu/teacher/student-detail', () => ({ canTeacherSeeStudent: mockCanSee }));
vi.mock('@/features/setu/teacher/award-achievement', () => ({ awardAchievement: mockAward }));

function req(role: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) { headers['x-portal-role'] = role; headers['x-portal-uid'] = 'uid-teacher'; headers['x-portal-mid'] = 'CMT-A-01'; }
  return new Request('http://localhost/api/setu/teacher/achievements', { method: 'POST', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const body = { mid: 'CMT-F1-02', title: 'Om Award', programKey: 'bala-vihar' };

beforeEach(() => { vi.clearAllMocks(); mockCanSee.mockResolvedValue(true); mockAward.mockResolvedValue({ achId: 'a1' }); });

describe('POST achievements', () => {
  it('403 for a non-teacher', async () => {
    const { POST } = await import('../route');
    expect((await POST(req('family-manager', body))).status).toBe(403);
    expect(mockAward).not.toHaveBeenCalled();
  });
  it('400 for a bad payload (empty title)', async () => {
    const { POST } = await import('../route');
    expect((await POST(req('teacher', { mid: 'CMT-F1-02', title: '  ' }))).status).toBe(400);
  });
  it('403 not-your-student when roster check fails (gate runs after parse)', async () => {
    mockCanSee.mockResolvedValue(false);
    const { POST } = await import('../route');
    expect((await POST(req('teacher', body))).status).toBe(403);
    expect(mockAward).not.toHaveBeenCalled();
  });
  it('201 awards with awardedByUid from session + null awardedByName', async () => {
    const { POST } = await import('../route');
    const res = await POST(req('teacher', body));
    expect(res.status).toBe(201);
    expect(mockAward).toHaveBeenCalledWith(expect.objectContaining({
      fid: 'CMT-F1', mid: 'CMT-F1-02', title: 'Om Award', programKey: 'bala-vihar',
      description: null, awardedByUid: 'uid-teacher', awardedByName: null,
    }));
    expect((await res.json()).achId).toBe('a1');
  });
});
