import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockCreate = vi.fn();
const mockPeriodGet = vi.fn();
const mockCollection = vi.fn();
const mockAssignTeacher = vi.fn();
const mockGetTeacherLevelIds = vi.fn();
const mockResolveTeacherEmail = vi.fn();
class MockTeacherEmailResolutionError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const Timestamp = {
    now: () => ({ toDate: () => new Date() }),
    fromDate: (d: Date) => ({ toDate: () => d }),
  };
  const FieldValue = { serverTimestamp: () => 'SERVER_TS' };
  return { Timestamp, FieldValue, portalFirestore: vi.fn(() => ({ collection: mockCollection })) };
});
vi.mock('@/features/setu/teacher/assignments', () => ({
  assignTeacher: mockAssignTeacher,
  getTeacherLevelIds: mockGetTeacherLevelIds,
}));
vi.mock('@/features/setu/teacher/resolve-teacher-email', () => ({
  resolveTeacherEmail: mockResolveTeacherEmail,
  TeacherEmailResolutionError: MockTeacherEmailResolutionError,
}));

// The past-year guard resolves the live year via getSchoolYearConfig.
const { mockGetSchoolYearConfig } = vi.hoisted(() => ({ mockGetSchoolYearConfig: vi.fn() }));
vi.mock('@/features/setu/rollover/school-year-config', () => ({
  getSchoolYearConfig: mockGetSchoolYearConfig,
}));

const validBody = {
  programKey: 'bala-vihar',
  location: 'Brampton',
  pid: 'bv-brampton-2025-26',
  levelName: 'Level 2',
  levelKind: 'level',
  order: 4,
  gradeBand: ['Gr 2', 'Gr 3'],
  ageLabel: 'Gr 2 & 3',
  curriculum: 'Hanuman',
  enabled: true,
};

function makeRequest(method: string, body?: unknown, uid?: string, role = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-portal-role': role };
  if (uid) headers['x-portal-uid'] = uid;
  return new Request('http://localhost/api/admin/levels', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function makeTs(d: Date) {
  return { toDate: () => d };
}

beforeEach(() => {
  vi.clearAllMocks();
  // levels.doc(id) → { create, get }; donationPeriods.doc(pid) → { get: mockPeriodGet }
  mockCollection.mockImplementation((name: string) => {
    if (name === 'donationPeriods') {
      return { doc: vi.fn(() => ({ get: mockPeriodGet })) };
    }
    const orderByChain: { orderBy: () => typeof orderByChain; get: typeof mockGet } = {
      orderBy: () => orderByChain,
      get: mockGet,
    };
    return {
      orderBy: () => orderByChain,
      get: mockGet,
      doc: vi.fn(() => ({ create: mockCreate, get: mockGet })),
    };
  });
  mockGet.mockResolvedValue({ docs: [] });
  mockCreate.mockResolvedValue(undefined);
  mockPeriodGet.mockResolvedValue({ exists: true, data: () => ({ periodLabel: '2025-26' }) });
  mockGetSchoolYearConfig.mockResolvedValue({ currentYear: '2025-26' });
  mockAssignTeacher.mockResolvedValue({ added: [], removed: [] });
  mockGetTeacherLevelIds.mockResolvedValue(['old-level']);
  mockResolveTeacherEmail.mockResolvedValue({
    ref: 'CMT-FAM1-01',
    email: 'teacher@example.com',
    name: 'Teacher One',
  });
});

describe('GET /api/admin/levels', () => {
  it('returns 403 for non-admin', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET', undefined, undefined, 'family-manager'));
    expect(res.status).toBe(403);
  });

  it('returns 200 with empty levels', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).levels).toEqual([]);
  });

  it('serializes timestamps to ISO strings', async () => {
    const now = new Date('2025-09-01T00:00:00.000Z');
    mockGet.mockResolvedValue({
      docs: [
        {
          data: () => ({
            levelId: 'brampton-level-2-bv-brampton-2025-26',
            levelName: 'Level 2',
            createdAt: makeTs(now),
            updatedAt: makeTs(now),
          }),
        },
      ],
    });
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET'));
    const body = await res.json();
    expect(body.levels).toHaveLength(1);
    expect(typeof body.levels[0].createdAt).toBe('string');
  });
});

describe('POST /api/admin/levels', () => {
  it('returns 403 for non-admin', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin', 'welcome-team'));
    expect(res.status).toBe(403);
  });

  it('returns 401 without x-portal-uid', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody));
    expect(res.status).toBe(401);
  });

  it('returns 400 for a level with empty gradeBand', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { ...validBody, gradeBand: [] }, 'uid-admin'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the period does not exist', async () => {
    mockPeriodGet.mockResolvedValue({ exists: false });
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('period-not-found');
  });

  it('returns 201 with derived levelId', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(res.status).toBe(201);
    expect((await res.json()).levelId).toBe('brampton-level-2-bv-brampton-2025-26');
  });

  it('computes the next order when create omits order', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          data: () => ({
            programKey: 'bala-vihar',
            location: 'Brampton',
            pid: 'bv-brampton-2025-26',
            order: 7,
          }),
        },
        {
          data: () => ({
            programKey: 'bala-vihar',
            location: 'Scarborough',
            pid: 'bv-brampton-2025-26',
            order: 20,
          }),
        },
      ],
    });
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { ...validBody, order: undefined }, 'uid-admin'));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ order: 8 }));
    expect((await res.json()).order).toBe(8);
  });

  it('adds a create-time teacher email to that teacher assignment set', async () => {
    const { POST } = await import('../route');
    const res = await POST(
      makeRequest('POST', { ...validBody, teacherEmail: 'teacher@example.com' }, 'uid-admin'),
    );
    expect(res.status).toBe(201);
    expect(mockResolveTeacherEmail).toHaveBeenCalledWith('teacher@example.com');
    expect(mockGetTeacherLevelIds).toHaveBeenCalledWith('CMT-FAM1-01');
    expect(mockAssignTeacher).toHaveBeenCalledWith({
      ref: 'CMT-FAM1-01',
      levelIds: ['old-level', 'brampton-level-2-bv-brampton-2025-26'],
      byUid: 'uid-admin',
    });
    expect(await res.json()).toMatchObject({
      levelId: 'brampton-level-2-bv-brampton-2025-26',
      teacherRef: 'CMT-FAM1-01',
      teacherEmail: 'teacher@example.com',
    });
  });

  it('returns 404 when create-time teacher email is not registered', async () => {
    mockResolveTeacherEmail.mockRejectedValue(new MockTeacherEmailResolutionError('teacher-not-found'));
    const { POST } = await import('../route');
    const res = await POST(
      makeRequest('POST', { ...validBody, teacherEmail: 'missing@example.com' }, 'uid-admin'),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'teacher-not-found' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('derives a safe levelId for "Pre-Level A"', async () => {
    const { POST } = await import('../route');
    const res = await POST(
      makeRequest('POST', { ...validBody, location: 'Scarborough', levelName: 'Pre-Level A', levelKind: 'pre-level', gradeBand: ['JK', 'SK'] }, 'uid-admin'),
    );
    expect((await res.json()).levelId).toBe('scarborough-pre-level-a-bv-brampton-2025-26');
  });

  it('returns 201 for a parents level with empty gradeBand', async () => {
    const { POST } = await import('../route');
    const res = await POST(
      makeRequest('POST', { ...validBody, levelName: 'Parents', levelKind: 'parents', gradeBand: [], ageLabel: 'All Adults', curriculum: 'Gita' }, 'uid-admin'),
    );
    expect(res.status).toBe(201);
  });

  it('returns 409 when create() throws ALREADY_EXISTS (code 6)', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('exists'), { code: 6 }));
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('level-conflict');
  });

  it('returns 409 past-year when the period is in a past school year', async () => {
    // live = 2025-26; the period belongs to 2024-25 (past).
    mockPeriodGet.mockResolvedValue({ exists: true, data: () => ({ periodLabel: '2024-25' }) });
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'past-year', year: '2024-25', liveYear: '2025-26' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does NOT reject a live-year period (proceeds to create → 201)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validBody, 'uid-admin'));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalled();
  });
});
