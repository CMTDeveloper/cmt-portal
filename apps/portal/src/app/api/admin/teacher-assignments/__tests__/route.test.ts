import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAssignTeacher, mockFindMissingLevelIds } = vi.hoisted(() => ({
  mockAssignTeacher: vi.fn(),
  mockFindMissingLevelIds: vi.fn(),
}));
const { mockResolveTeacherEmail, MockTeacherEmailResolutionError } = vi.hoisted(() => ({
  mockResolveTeacherEmail: vi.fn(),
  MockTeacherEmailResolutionError: class TeacherEmailResolutionError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  },
}));
vi.mock('@/features/setu/teacher/assignments', () => ({ assignTeacher: mockAssignTeacher }));
vi.mock('@/features/setu/teacher/levels', () => ({ findMissingLevelIds: mockFindMissingLevelIds }));
vi.mock('@/features/setu/teacher/resolve-teacher-email', () => ({
  resolveTeacherEmail: mockResolveTeacherEmail,
  TeacherEmailResolutionError: MockTeacherEmailResolutionError,
}));

// The past-year guard reads each targeted level's pid via portalFirestore().getAll
// and resolves the live year via getSchoolYearConfig. Mock both.
const { mockGetAll, mockLevelDoc } = vi.hoisted(() => ({ mockGetAll: vi.fn(), mockLevelDoc: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ collection: () => ({ doc: mockLevelDoc }), getAll: mockGetAll }),
}));
const { mockGetSchoolYearConfig } = vi.hoisted(() => ({ mockGetSchoolYearConfig: vi.fn() }));
vi.mock('@/features/setu/rollover/school-year-config', () => ({
  getSchoolYearConfig: mockGetSchoolYearConfig,
}));

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
  mockFindMissingLevelIds.mockResolvedValue([]);
  mockResolveTeacherEmail.mockResolvedValue({
    ref: 'CMT-FAM1-01',
    email: 'teacher@example.com',
    name: 'Teacher One',
  });
  // Default: every targeted level is in the LIVE year (guard passes).
  mockLevelDoc.mockImplementation((id: string) => ({ id }));
  mockGetAll.mockResolvedValue([{ data: () => ({ pid: 'bv-brampton-2025-26' }) }]);
  mockGetSchoolYearConfig.mockResolvedValue({ currentYear: '2025-26' });
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

  it('returns 400 unknown-levels when a level does not exist', async () => {
    mockFindMissingLevelIds.mockResolvedValue(['ghost']);
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ ref: 'CMT-FAM1-01', levelIds: ['ghost'] }, 'uid-admin'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unknown-levels', missing: ['ghost'] });
    expect(mockAssignTeacher).not.toHaveBeenCalled();
  });

  it('assigns when all levels exist', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(body, 'uid-admin'));
    expect(res.status).toBe(200);
    expect(mockFindMissingLevelIds).toHaveBeenCalledWith(['l1']);
    expect(mockAssignTeacher).toHaveBeenCalledWith({ ref: 'CMT-FAM1-01', levelIds: ['l1'], byUid: 'uid-admin' });
  });

  it('resolves a teacher email before assigning', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ teacherEmail: 'teacher@example.com', levelIds: ['l1'] }, 'uid-admin'));
    expect(res.status).toBe(200);
    expect(mockResolveTeacherEmail).toHaveBeenCalledWith('teacher@example.com');
    expect(mockAssignTeacher).toHaveBeenCalledWith({ ref: 'CMT-FAM1-01', levelIds: ['l1'], byUid: 'uid-admin' });
    expect(await res.json()).toMatchObject({ ref: 'CMT-FAM1-01', teacherEmail: 'teacher@example.com' });
  });

  it('returns a friendly status when teacher email is not registered', async () => {
    mockResolveTeacherEmail.mockRejectedValue(new MockTeacherEmailResolutionError('teacher-not-found'));
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ teacherEmail: 'missing@example.com', levelIds: ['l1'] }, 'uid-admin'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'teacher-not-found' });
    expect(mockAssignTeacher).not.toHaveBeenCalled();
  });

  it('409 past-year when a targeted level is in a past school year', async () => {
    // live = 2025-26 (default); the targeted level belongs to 2024-25 (past).
    mockGetAll.mockResolvedValue([{ data: () => ({ pid: 'bv-brampton-2024-25' }) }]);
    const { POST } = await import('../route');
    const res = await POST(makeRequest(body, 'uid-admin'));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'past-year', year: '2024-25', liveYear: '2025-26' });
    expect(mockAssignTeacher).not.toHaveBeenCalled();
  });

  it('does NOT reject a live-year level (guard passes → assigns)', async () => {
    mockGetAll.mockResolvedValue([{ data: () => ({ pid: 'bv-brampton-2025-26' }) }]);
    const { POST } = await import('../route');
    const res = await POST(makeRequest(body, 'uid-admin'));
    expect(res.status).toBe(200);
    expect(mockAssignTeacher).toHaveBeenCalled();
  });

  it('does NOT reject a preparing (future) level (prep writes are allowed)', async () => {
    mockGetAll.mockResolvedValue([{ data: () => ({ pid: 'bv-brampton-2026-27' }) }]);
    const { POST } = await import('../route');
    const res = await POST(makeRequest(body, 'uid-admin'));
    expect(res.status).toBe(200);
    expect(mockAssignTeacher).toHaveBeenCalled();
  });
});
