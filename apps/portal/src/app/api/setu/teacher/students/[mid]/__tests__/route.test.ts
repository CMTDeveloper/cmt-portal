import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCanSee, mockGetDetail } = vi.hoisted(() => ({ mockCanSee: vi.fn(), mockGetDetail: vi.fn() }));
vi.mock('@/features/setu/teacher/student-detail', () => ({
  canTeacherSeeStudent: mockCanSee,
  getStudentDetail: mockGetDetail,
}));

function req(role: string | null, mid = 'CMT-A-02'): Request {
  const headers: Record<string, string> = {};
  if (role) { headers['x-portal-role'] = role; headers['x-portal-uid'] = 'uid-x'; headers['x-portal-mid'] = 'CMT-A-01'; }
  return new Request('http://localhost/api/setu/teacher/students/' + mid, { method: 'GET', headers });
}
const params = (mid = 'CMT-A-02') => ({ params: Promise.resolve({ mid }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockCanSee.mockResolvedValue(true);
  mockGetDetail.mockResolvedValue({ mid: 'CMT-A-02', firstName: 'Arjun', summary: { total: 0 } });
});

describe('GET /api/setu/teacher/students/[mid]', () => {
  it('403 for a non-teacher', async () => {
    const { GET } = await import('../route');
    expect((await GET(req('family-manager'), params())).status).toBe(403);
  });
  it('403 not-your-student when the teacher cannot see them', async () => {
    mockCanSee.mockResolvedValue(false);
    const { GET } = await import('../route');
    const res = await GET(req('teacher'), params());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('not-your-student');
    expect(mockGetDetail).not.toHaveBeenCalled();
  });
  it('404 when the student is not found', async () => {
    mockGetDetail.mockResolvedValue(null);
    const { GET } = await import('../route');
    expect((await GET(req('teacher'), params())).status).toBe(404);
  });
  it('200 with the student detail for an authorized teacher', async () => {
    const { GET } = await import('../route');
    const res = await GET(req('teacher'), params());
    expect(res.status).toBe(200);
    expect((await res.json()).student.mid).toBe('CMT-A-02');
  });
  it('allows admin (inherits teacher)', async () => {
    const { GET } = await import('../route');
    expect((await GET(req('admin'), params())).status).toBe(200);
  });
});
