import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCanTeach, mockGetEligible, mockMarkGuest } = vi.hoisted(() => ({
  mockCanTeach: vi.fn(),
  mockGetEligible: vi.fn(),
  mockMarkGuest: vi.fn(),
}));
vi.mock('@/features/setu/teacher/guard', () => ({ canTeachLevel: mockCanTeach }));
vi.mock('@/features/setu/teacher/grade-eligible', () => ({ getGradeEligibleUnenrolled: mockGetEligible }));
vi.mock('@/features/setu/teacher/guests', () => ({ markGuest: mockMarkGuest }));

function getReq(role: string | null, levelId = 'lvl'): Request {
  const headers: Record<string, string> = {};
  if (role) { headers['x-portal-role'] = role; headers['x-portal-uid'] = 'uid-teacher'; headers['x-portal-mid'] = 'CMT-A-01'; }
  const qs = levelId ? `?levelId=${levelId}` : '';
  return new Request(`http://localhost/api/setu/teacher/grade-eligible${qs}`, { method: 'GET', headers });
}
function postReq(role: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) { headers['x-portal-role'] = role; headers['x-portal-uid'] = 'uid-teacher'; headers['x-portal-mid'] = 'CMT-A-01'; }
  return new Request('http://localhost/api/setu/teacher/grade-eligible', { method: 'POST', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

const view = { levelId: 'lvl', levelName: 'Level 2', ageLabel: 'Gr 2 & 3', students: [{ mid: 'FAM-6-03', fid: 'FAM-6', firstName: 'Child1', lastName: 'Family6', schoolGrade: 'Grade 2', familyName: 'Family6' }] };
const markBody = { levelId: 'lvl', mid: 'FAM-6-03', date: '2026-10-04' };

beforeEach(() => {
  vi.clearAllMocks();
  mockCanTeach.mockResolvedValue('ok');
  mockGetEligible.mockResolvedValue(view);
  mockMarkGuest.mockResolvedValue({ ok: true, aid: 'aid', autoEnrolled: true });
});

describe('GET /api/setu/teacher/grade-eligible', () => {
  it('403 for a non-teacher', async () => {
    const { GET } = await import('../route');
    expect((await GET(getReq('family-manager'))).status).toBe(403);
    expect(mockGetEligible).not.toHaveBeenCalled();
  });
  it('400 without levelId', async () => {
    const { GET } = await import('../route');
    expect((await GET(getReq('teacher', ''))).status).toBe(400);
  });
  it('403 not-your-class when unassigned', async () => {
    mockCanTeach.mockResolvedValue('forbidden');
    const { GET } = await import('../route');
    const res = await GET(getReq('teacher'));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('not-your-class');
  });
  it('200 returns the eligible-unenrolled view', async () => {
    const { GET } = await import('../route');
    const res = await GET(getReq('teacher'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ view });
    expect(mockGetEligible).toHaveBeenCalledWith('lvl');
  });
});

describe('POST /api/setu/teacher/grade-eligible (mark present → auto-enroll)', () => {
  it('403 for a non-teacher', async () => {
    const { POST } = await import('../route');
    expect((await POST(postReq('family-manager', markBody))).status).toBe(403);
    expect(mockMarkGuest).not.toHaveBeenCalled();
  });
  it('400 for a bad payload (missing mid)', async () => {
    const { POST } = await import('../route');
    expect((await POST(postReq('teacher', { levelId: 'lvl', date: '2026-10-04' }))).status).toBe(400);
    expect(mockMarkGuest).not.toHaveBeenCalled();
  });
  it('marks present as a guest (auto-enroll) with session uid/mid', async () => {
    const { POST } = await import('../route');
    const res = await POST(postReq('teacher', markBody));
    expect(res.status).toBe(200);
    expect(mockMarkGuest).toHaveBeenCalledWith(expect.objectContaining({
      levelId: 'lvl', mid: 'FAM-6-03', date: '2026-10-04', status: 'present',
      markedByUid: 'uid-teacher', markedByMid: 'CMT-A-01',
    }));
    expect(await res.json()).toEqual({ ok: true, autoEnrolled: true });
  });
  it('404 when the member is not found', async () => {
    mockMarkGuest.mockResolvedValue({ ok: false, reason: 'level-not-found' });
    const { POST } = await import('../route');
    expect((await POST(postReq('teacher', markBody))).status).toBe(404);
  });
});
