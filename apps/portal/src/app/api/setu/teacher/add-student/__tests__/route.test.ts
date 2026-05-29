import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCanTeach, mockAdd } = vi.hoisted(() => ({ mockCanTeach: vi.fn(), mockAdd: vi.fn() }));
vi.mock('@/features/setu/teacher/guard', () => ({ canTeachLevel: mockCanTeach }));
vi.mock('@/features/setu/teacher/add-student', () => ({ addStudentOnPrompt: mockAdd }));

function req(body: unknown, role: string | null = 'teacher'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) { headers['x-portal-role'] = role; headers['x-portal-uid'] = 'uid-t'; headers['x-portal-mid'] = 'CMT-T-01'; }
  return new Request('http://localhost/api/setu/teacher/add-student', { method: 'POST', headers, body: JSON.stringify(body) });
}

const body = { levelId: 'lvl', date: '2025-09-07', firstName: 'New', lastName: 'Kid', parentEmail: 'p@example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  mockCanTeach.mockResolvedValue('ok');
  mockAdd.mockResolvedValue({ ok: true, fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true, autoEnrolled: true });
});

describe('POST /api/setu/teacher/add-student', () => {
  it('403 for non-teacher', async () => {
    const { POST } = await import('../route');
    expect((await POST(req(body, 'family-manager'))).status).toBe(403);
    expect(mockAdd).not.toHaveBeenCalled();
  });
  it('400 for invalid email', async () => {
    const { POST } = await import('../route');
    expect((await POST(req({ ...body, parentEmail: 'nope' }))).status).toBe(400);
  });
  it('403 not-your-class when unassigned', async () => {
    mockCanTeach.mockResolvedValue('forbidden');
    const { POST } = await import('../route');
    expect((await POST(req(body))).status).toBe(403);
    expect(mockAdd).not.toHaveBeenCalled();
  });
  it('404 when level missing', async () => {
    mockCanTeach.mockResolvedValue('level-not-found');
    const { POST } = await import('../route');
    expect((await POST(req(body))).status).toBe(404);
  });
  it('200 returns fid/childMid + createdFamily + passes teacher session', async () => {
    const { POST } = await import('../route');
    const res = await POST(req(body));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true, autoEnrolled: true });
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ levelId: 'lvl', parentEmail: 'p@example.com', markedByUid: 'uid-t', markedByMid: 'CMT-T-01' }));
  });
});
