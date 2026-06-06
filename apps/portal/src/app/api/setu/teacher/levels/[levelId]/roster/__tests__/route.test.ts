import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCanTeach, mockView } = vi.hoisted(() => ({ mockCanTeach: vi.fn(), mockView: vi.fn() }));
vi.mock('@/features/setu/teacher/guard', () => ({ canTeachLevel: mockCanTeach }));
vi.mock('@/features/setu/teacher/level-attendance-view', () => ({ getLevelAttendanceView: mockView }));
vi.mock('@/features/setu/calendar/calendar', () => ({ mostRecentSunday: () => '2025-09-07' }));

function req(role: string | null, url = '/api/setu/teacher/levels/lvl/roster', mid?: string): Request {
  const headers: Record<string, string> = {};
  if (role) { headers['x-portal-role'] = role; headers['x-portal-uid'] = 'uid-x'; }
  if (mid) headers['x-portal-mid'] = mid;
  return new Request(`http://localhost${url}`, { method: 'GET', headers });
}
const params = (levelId = 'lvl') => ({ params: Promise.resolve({ levelId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockCanTeach.mockResolvedValue('ok');
  mockView.mockResolvedValue({ levelId: 'lvl', levelName: 'Level 1', ageLabel: 'Gr 1', location: 'Hall', pid: 'pid', date: '2025-09-07', rows: [], presentCount: 0, total: 0 });
});

describe('GET roster', () => {
  it('403 for a non-teacher', async () => {
    const { GET } = await import('../route');
    expect((await GET(req('family-manager', undefined, 'CMT-A-01'), params())).status).toBe(403);
  });
  it('403 not-your-class when not assigned', async () => {
    mockCanTeach.mockResolvedValue('forbidden');
    const { GET } = await import('../route');
    const res = await GET(req('teacher', undefined, 'CMT-A-01'), params());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('not-your-class');
  });
  it('404 when level missing', async () => {
    mockCanTeach.mockResolvedValue('level-not-found');
    const { GET } = await import('../route');
    expect((await GET(req('teacher', undefined, 'CMT-A-01'), params())).status).toBe(404);
  });
  it('200 with view, defaulting date to the most recent Sunday', async () => {
    const { GET } = await import('../route');
    const res = await GET(req('teacher', undefined, 'CMT-A-01'), params());
    expect(res.status).toBe(200);
    expect((await res.json()).view).toMatchObject({ levelId: 'lvl' });
    expect(mockView).toHaveBeenCalledWith('lvl', '2025-09-07');
  });
  it('uses the date query param when present', async () => {
    const { GET } = await import('../route');
    await GET(req('teacher', '/api/setu/teacher/levels/lvl/roster?date=2025-10-19', 'CMT-A-01'), params());
    expect(mockView).toHaveBeenCalledWith('lvl', '2025-10-19');
  });
  it('400 for a malformed date', async () => {
    const { GET } = await import('../route');
    expect((await GET(req('teacher', '/api/setu/teacher/levels/lvl/roster?date=Oct-19', 'CMT-A-01'), params())).status).toBe(400);
  });
  it('allows admin (inherits teacher)', async () => {
    const { GET } = await import('../route');
    expect((await GET(req('admin'), params())).status).toBe(200);
  });
});
