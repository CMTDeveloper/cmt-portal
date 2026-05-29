import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCanTeach, mockSave } = vi.hoisted(() => ({ mockCanTeach: vi.fn(), mockSave: vi.fn() }));
vi.mock('@/features/setu/teacher/guard', () => ({ canTeachLevel: mockCanTeach }));
vi.mock('@/features/setu/teacher/save-attendance', () => ({ saveAttendance: mockSave }));

function req(role: string | null, body?: unknown, mid = 'CMT-A-01'): Request {
  const headers: Record<string, string> = {};
  if (role) { headers['x-portal-role'] = role; headers['x-portal-uid'] = 'uid-teacher'; }
  if (mid) headers['x-portal-mid'] = mid;
  headers['content-type'] = 'application/json';
  return new Request('http://localhost/api/setu/teacher/attendance', { method: 'POST', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

const body = { levelId: 'lvl', date: '2025-09-07', marks: { 'CMT-A-02': 'present' } };

beforeEach(() => {
  vi.clearAllMocks();
  mockCanTeach.mockResolvedValue('ok');
  mockSave.mockResolvedValue({ ok: true, saved: 1, skipped: [] });
});

describe('POST attendance', () => {
  it('403 for a non-teacher', async () => {
    const { POST } = await import('../route');
    expect((await POST(req('family-manager', body))).status).toBe(403);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('400 for a bad payload', async () => {
    const { POST } = await import('../route');
    expect((await POST(req('teacher', { levelId: 'lvl', date: 'bad', marks: {} }))).status).toBe(400);
  });
  it('403 not-your-class when unassigned (guard runs after parse)', async () => {
    mockCanTeach.mockResolvedValue('forbidden');
    const { POST } = await import('../route');
    const res = await POST(req('teacher', body));
    expect(res.status).toBe(403);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('404 when level missing', async () => {
    mockCanTeach.mockResolvedValue('level-not-found');
    const { POST } = await import('../route');
    expect((await POST(req('teacher', body))).status).toBe(404);
  });
  it('200 saves with markedByUid + markedByMid from session', async () => {
    const { POST } = await import('../route');
    const res = await POST(req('teacher', body));
    expect(res.status).toBe(200);
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
      levelId: 'lvl', date: '2025-09-07', marks: { 'CMT-A-02': 'present' },
      markedByUid: 'uid-teacher', markedByMid: 'CMT-A-01',
    }));
    expect((await res.json()).saved).toBe(1);
  });
});
