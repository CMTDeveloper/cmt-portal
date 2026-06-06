import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSession, mockCanTeach, mockView, mockAdd } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockCanTeach: vi.fn(),
  mockView: vi.fn(),
  mockAdd: vi.fn(),
}));
vi.mock('@/lib/auth/headers', () => ({ readSessionFromHeaders: mockSession }));
vi.mock('@/features/setu/teacher/guard', () => ({ canTeachLevel: mockCanTeach }));
vi.mock('@/features/setu/teacher/visitors', () => ({ getLevelVisitorsView: mockView, addVisitorOnPrompt: mockAdd }));

import { GET, POST } from '../route';

const teacher = { uid: 'uid-t', role: 'teacher', extraRoles: [], fid: null, mid: 'CMT-T-01' };

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockReturnValue(teacher);
  mockCanTeach.mockResolvedValue('ok');
});

function get(url: string) { return GET(new Request(url)); }
function post(body: unknown) {
  return POST(new Request('http://t/api/setu/teacher/visitors', { method: 'POST', body: JSON.stringify(body) }));
}

describe('GET /api/setu/teacher/visitors', () => {
  it('403 when not a teacher', async () => {
    mockSession.mockReturnValue({ ...teacher, role: 'family-manager' });
    expect((await get('http://t/api/setu/teacher/visitors?levelId=L&date=2026-01-04')).status).toBe(403);
  });
  it('400 on a bad date', async () => {
    expect((await get('http://t/api/setu/teacher/visitors?levelId=L&date=nope')).status).toBe(400);
  });
  it('404 when the level is missing', async () => {
    mockView.mockResolvedValue(null);
    expect((await get('http://t/api/setu/teacher/visitors?levelId=L&date=2026-01-04')).status).toBe(404);
  });
  it('returns the view on success', async () => {
    mockView.mockResolvedValue({ levelId: 'L', doorVisitors: [], confirmed: [] });
    const res = await get('http://t/api/setu/teacher/visitors?levelId=L&date=2026-01-04');
    expect(res.status).toBe(200);
    expect((await res.json()).view).toMatchObject({ levelId: 'L' });
  });
});

describe('POST /api/setu/teacher/visitors', () => {
  it('403 without a teacher uid', async () => {
    mockSession.mockReturnValue(null);
    expect((await post({ levelId: 'L', date: '2026-01-04', firstName: 'A' })).status).toBe(403);
  });
  it('400 on a blank firstName', async () => {
    expect((await post({ levelId: 'L', date: '2026-01-04', firstName: '   ' })).status).toBe(400);
  });
  it('403 not-your-class', async () => {
    mockCanTeach.mockResolvedValue('forbidden');
    expect((await post({ levelId: 'L', date: '2026-01-04', firstName: 'A' })).status).toBe(403);
  });
  it('adds a name-only walk-in and echoes the result', async () => {
    mockAdd.mockResolvedValue({ ok: true, fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true, autoEnrolled: true, claimable: false });
    const res = await post({ levelId: 'L', date: '2026-01-04', firstName: 'Walk' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true, claimable: false });
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      levelId: 'L', firstName: 'Walk', lastName: '', schoolGrade: null, parentEmail: null, parentPhone: null,
      markedByUid: 'uid-t', markedByMid: 'CMT-T-01',
    }));
  });
});
