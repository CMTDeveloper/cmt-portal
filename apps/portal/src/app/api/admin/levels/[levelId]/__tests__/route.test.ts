import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockWhereGet = vi.fn();
const mockUpdate = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const FieldValue = { serverTimestamp: () => 'SERVER_TS' };
  return { FieldValue, portalFirestore: vi.fn(() => ({ collection: mockCollection })) };
});

// The past-year guard resolves the live year via getSchoolYearConfig.
const { mockGetSchoolYearConfig } = vi.hoisted(() => ({ mockGetSchoolYearConfig: vi.fn() }));
vi.mock('@/features/setu/rollover/school-year-config', () => ({
  getSchoolYearConfig: mockGetSchoolYearConfig,
}));

function makeRequest(method: string, body?: unknown, uid?: string, role = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-portal-role': role };
  if (uid) headers['x-portal-uid'] = uid;
  return new Request('http://localhost/api/admin/levels/brampton-level-2-bv-brampton-2025-26', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const EXISTING = {
  levelId: 'brampton-level-2-bv-brampton-2025-26',
  levelName: 'Level 2',
  location: 'Brampton',
  pid: 'bv-brampton-2025-26',
  levelKind: 'level',
  gradeBand: ['Gr 2', 'Gr 3'],
  periodLabel: '2025-26',
  teacherRefs: ['CMT-FAM1-01', 'CMT-FAM2-01'],
};

const params = (levelId = 'brampton-level-2-bv-brampton-2025-26') => ({
  params: Promise.resolve({ levelId }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDoc.mockReturnValue({ get: mockGet, update: mockUpdate });
  mockCollection.mockReturnValue({ doc: mockDoc, where: () => ({ get: mockWhereGet }) });
  mockGet.mockResolvedValue({ exists: true, data: () => EXISTING });
  mockWhereGet.mockResolvedValue({ docs: [] });
  mockUpdate.mockResolvedValue(undefined);
  mockGetSchoolYearConfig.mockResolvedValue({ currentYear: '2025-26' });
});

describe('PATCH /api/admin/levels/[levelId]', () => {
  it('returns 403 for non-admin', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('PATCH', { enabled: false }, 'uid-admin', 'welcome-team'), params());
    expect(res.status).toBe(403);
  });

  it('returns 401 without x-portal-uid', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('PATCH', { enabled: false }), params());
    expect(res.status).toBe(401);
  });

  it('returns 404 when the level does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('PATCH', { enabled: false }, 'uid-admin'), params('nope'));
    expect(res.status).toBe(404);
  });

  it('returns 200 and writes only provided fields', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('PATCH', { levelName: 'Level 2 (renamed)', enabled: false }, 'uid-admin'), params());
    expect(res.status).toBe(200);
    const update = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(update.levelName).toBe('Level 2 (renamed)');
    expect(update.enabled).toBe(false);
    expect(update.updatedBy).toBe('uid-admin');
    expect('gradeBand' in update).toBe(false);
  });

  it('rejects clearing gradeBand on a level kind (400)', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('PATCH', { gradeBand: [] }, 'uid-admin'), params());
    expect(res.status).toBe(400);
  });

  it('allows clearing gradeBand when also switching to parents kind', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest('PATCH', { levelKind: 'parents', gradeBand: [] }, 'uid-admin'),
      params(),
    );
    expect(res.status).toBe(200);
  });

  it('returns 409 past-year when the level is in a past school year', async () => {
    // live = 2025-26; this level's periodLabel is 2024-25 (past).
    mockGet.mockResolvedValue({ exists: true, data: () => ({ ...EXISTING, periodLabel: '2024-25' }) });
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('PATCH', { enabled: false }, 'uid-admin'), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'past-year', year: '2024-25', liveYear: '2025-26' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does NOT reject a live-year level (updates)', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('PATCH', { enabled: false }, 'uid-admin'), params());
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('returns 409 level-conflict when a rename collides with a sibling name in the same location+pid', async () => {
    // The pid holds this level (Level 2) plus a sibling "Level 3"; renaming
    // Level 2 → "Level 3" would produce two levels showing the same name.
    mockWhereGet.mockResolvedValue({
      docs: [
        { id: EXISTING.levelId, data: () => ({ location: 'Brampton', levelName: 'Level 2' }) },
        {
          id: 'brampton-level-3-bv-brampton-2025-26',
          data: () => ({ location: 'Brampton', levelName: 'Level 3' }),
        },
      ],
    });
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('PATCH', { levelName: 'Level 3' }, 'uid-admin'), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'level-conflict',
      levelId: 'brampton-level-3-bv-brampton-2025-26',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('renames to a fresh unique name (200) — self is skipped via exceptLevelId', async () => {
    // The where read returns only self; renaming to a brand-new name must not
    // self-conflict.
    mockWhereGet.mockResolvedValue({
      docs: [{ id: EXISTING.levelId, data: () => ({ location: 'Brampton', levelName: 'Level 2' }) }],
    });
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('PATCH', { levelName: 'Level 9' }, 'uid-admin'), params());
    expect(res.status).toBe(200);
    const update = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(update.levelName).toBe('Level 9');
  });

  it('persists a leadTeacherRef that is one of the level teacherRefs', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('PATCH', { leadTeacherRef: 'CMT-FAM1-01' }, 'uid-admin'), params());
    expect(res.status).toBe(200);
    const update = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(update.leadTeacherRef).toBe('CMT-FAM1-01');
  });

  it('accepts a null leadTeacherRef (clears the Lead)', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('PATCH', { leadTeacherRef: null }, 'uid-admin'), params());
    expect(res.status).toBe(200);
    const update = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(update.leadTeacherRef).toBeNull();
  });

  it('rejects a leadTeacherRef that is not one of the level teacherRefs (400 lead-not-a-teacher)', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('PATCH', { leadTeacherRef: 'CMT-NOPE-99' }, 'uid-admin'), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'lead-not-a-teacher' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not 500 when renaming a phantom level doc that has no levelName', async () => {
    // Field-less phantom {teacherRefs:[]} docs exist in UAT (no levelName). A PATCH
    // carrying a levelName must not throw on normalizeLevelName(undefined) — the
    // `existing.levelName ?? ''` guard mirrors the adjacent `existing.location ?? ''`.
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ levelId: EXISTING.levelId, pid: EXISTING.pid, location: 'Brampton', periodLabel: '2025-26', teacherRefs: [] }),
    });
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest('PATCH', { levelName: 'Recovered Name' }, 'uid-admin'), params());
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
  });
});
