import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCanTeach, mockConfirm } = vi.hoisted(() => ({ mockCanTeach: vi.fn(), mockConfirm: vi.fn() }));
vi.mock('@/features/setu/teacher/guard', () => ({ canTeachLevel: mockCanTeach }));
vi.mock('@/features/setu/teacher/confirm-previous', () => ({ confirmPreviousStudent: mockConfirm }));

function req(role: string | null, body?: unknown, mid = 'CMT-A-01'): Request {
  const headers: Record<string, string> = {};
  if (role) { headers['x-portal-role'] = role; headers['x-portal-uid'] = 'uid-teacher'; }
  if (mid) headers['x-portal-mid'] = mid;
  headers['content-type'] = 'application/json';
  return new Request('http://localhost/api/setu/teacher/attendance/confirm-previous', { method: 'POST', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

const body = { levelId: 'lvl', mid: 'CMT-B-02', date: '2025-09-07' };

beforeEach(() => {
  vi.clearAllMocks();
  mockCanTeach.mockResolvedValue('ok');
  mockConfirm.mockResolvedValue({ ok: true, fid: 'C' });
});

describe('POST confirm-previous', () => {
  it('403 for a non-teacher', async () => {
    const { POST } = await import('../route');
    expect((await POST(req('family-manager', body))).status).toBe(403);
    expect(mockConfirm).not.toHaveBeenCalled();
  });
  it('400 for a bad payload (missing mid)', async () => {
    const { POST } = await import('../route');
    expect((await POST(req('teacher', { levelId: 'lvl', date: '2025-09-07' }))).status).toBe(400);
    expect(mockConfirm).not.toHaveBeenCalled();
  });
  it('403 not-your-class when unassigned (guard runs after parse)', async () => {
    mockCanTeach.mockResolvedValue('forbidden');
    const { POST } = await import('../route');
    const res = await POST(req('teacher', body));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('not-your-class');
    expect(mockConfirm).not.toHaveBeenCalled();
  });
  it('404 when level missing', async () => {
    mockCanTeach.mockResolvedValue('level-not-found');
    const { POST } = await import('../route');
    expect((await POST(req('teacher', body))).status).toBe(404);
    expect(mockConfirm).not.toHaveBeenCalled();
  });
  it('200 confirms with markedByUid + markedByMid from session', async () => {
    const { POST } = await import('../route');
    const res = await POST(req('teacher', body));
    expect(res.status).toBe(200);
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      levelId: 'lvl', mid: 'CMT-B-02', date: '2025-09-07',
      markedByUid: 'uid-teacher', markedByMid: 'CMT-A-01',
    }));
    expect(await res.json()).toEqual({ ok: true, fid: 'C' });
  });
  it('400 when the target is not a previous student', async () => {
    mockConfirm.mockResolvedValue({ ok: false, reason: 'not-a-previous-student' });
    const { POST } = await import('../route');
    const res = await POST(req('teacher', body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('not-a-previous-student');
  });
});
