import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCanTeach, mockMarkGuest, mockListGuests } = vi.hoisted(() => ({
  mockCanTeach: vi.fn(),
  mockMarkGuest: vi.fn(),
  mockListGuests: vi.fn(),
}));
vi.mock('@/features/setu/teacher/guard', () => ({ canTeachLevel: mockCanTeach }));
vi.mock('@/features/setu/teacher/guests', () => ({ markGuest: mockMarkGuest, listGuests: mockListGuests }));

function req(method: string, url: string, body?: unknown, role: string | null = 'teacher'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) { headers['x-portal-role'] = role; headers['x-portal-uid'] = 'uid-t'; headers['x-portal-mid'] = 'CMT-T-01'; }
  return new Request(`http://localhost${url}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCanTeach.mockResolvedValue('ok');
  mockMarkGuest.mockResolvedValue({ ok: true, aid: 'lvl-CMT-Z-09-2025-09-07', autoEnrolled: true });
  mockListGuests.mockResolvedValue([{ aid: 'a1', mid: 'CMT-Z-09', fid: 'CMT-Z', date: '2025-09-07', status: 'present' }]);
});

describe('GET /api/setu/teacher/guests', () => {
  it('403 for non-teacher', async () => {
    const { GET } = await import('../route');
    expect((await GET(req('GET', '/api/setu/teacher/guests?levelId=lvl&date=2025-09-07', undefined, 'family-manager'))).status).toBe(403);
  });
  it('400 without levelId/date', async () => {
    const { GET } = await import('../route');
    expect((await GET(req('GET', '/api/setu/teacher/guests?levelId=lvl'))).status).toBe(400);
  });
  it('200 lists guests for an assigned teacher', async () => {
    const { GET } = await import('../route');
    const res = await GET(req('GET', '/api/setu/teacher/guests?levelId=lvl&date=2025-09-07'));
    expect(res.status).toBe(200);
    expect((await res.json()).guests).toHaveLength(1);
  });
});

describe('POST /api/setu/teacher/guests', () => {
  const body = { levelId: 'lvl', date: '2025-09-07', mid: 'CMT-Z-09', status: 'present' };
  it('403 for non-teacher', async () => {
    const { POST } = await import('../route');
    expect((await POST(req('POST', '/api/setu/teacher/guests', body, 'family-manager'))).status).toBe(403);
  });
  it('403 not-your-class when unassigned', async () => {
    mockCanTeach.mockResolvedValue('forbidden');
    const { POST } = await import('../route');
    expect((await POST(req('POST', '/api/setu/teacher/guests', body))).status).toBe(403);
    expect(mockMarkGuest).not.toHaveBeenCalled();
  });
  it('400 for a bad payload', async () => {
    const { POST } = await import('../route');
    expect((await POST(req('POST', '/api/setu/teacher/guests', { levelId: 'lvl', date: 'bad' }))).status).toBe(400);
  });
  it('200 marks guest + reports autoEnrolled', async () => {
    const { POST } = await import('../route');
    const res = await POST(req('POST', '/api/setu/teacher/guests', body));
    expect(res.status).toBe(200);
    expect((await res.json()).autoEnrolled).toBe(true);
    expect(mockMarkGuest).toHaveBeenCalledWith(expect.objectContaining({ levelId: 'lvl', mid: 'CMT-Z-09', markedByUid: 'uid-t', markedByMid: 'CMT-T-01' }));
  });
  it('404 when the member is not found', async () => {
    mockMarkGuest.mockResolvedValue({ ok: false, reason: 'member-not-found' });
    const { POST } = await import('../route');
    expect((await POST(req('POST', '/api/setu/teacher/guests', body))).status).toBe(404);
  });
});
