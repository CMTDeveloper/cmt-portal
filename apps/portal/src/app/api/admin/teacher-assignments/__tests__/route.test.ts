import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAssignTeacher } = vi.hoisted(() => ({ mockAssignTeacher: vi.fn() }));
vi.mock('@/features/setu/teacher/assignments', () => ({ assignTeacher: mockAssignTeacher }));

function makeRequest(body?: unknown, uid?: string, role = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-portal-role': role };
  if (uid) headers['x-portal-uid'] = uid;
  return new Request('http://localhost/api/admin/teacher-assignments', {
    method: 'POST',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAssignTeacher.mockResolvedValue({ added: ['l1'], removed: [] });
});

describe('POST /api/admin/teacher-assignments', () => {
  const body = { ref: 'CMT-FAM1-01', levelIds: ['l1'] };

  it('allows admin', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(body, 'uid-admin', 'admin'));
    expect(res.status).toBe(200);
    expect(mockAssignTeacher).toHaveBeenCalledWith({ ref: 'CMT-FAM1-01', levelIds: ['l1'], byUid: 'uid-admin' });
  });

  it('allows welcome-team (RBB-2)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(body, 'uid-w', 'welcome-team'));
    expect(res.status).toBe(200);
  });

  it('denies family-manager', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(body, 'uid-m', 'family-manager'));
    expect(res.status).toBe(403);
    expect(mockAssignTeacher).not.toHaveBeenCalled();
  });

  it('returns 401 without x-portal-uid', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(body, undefined, 'admin'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for a bad payload (missing ref)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ levelIds: ['l1'] }, 'uid-admin'));
    expect(res.status).toBe(400);
    expect(mockAssignTeacher).not.toHaveBeenCalled();
  });

  it('accepts clearing all levels (empty array)', async () => {
    mockAssignTeacher.mockResolvedValue({ added: [], removed: ['l1'] });
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ ref: 'CMT-FAM1-01', levelIds: [] }, 'uid-admin'));
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toEqual(['l1']);
  });
});
