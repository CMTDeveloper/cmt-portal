import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const FieldValue = { serverTimestamp: () => 'SERVER_TS' };
  return { FieldValue, portalFirestore: vi.fn(() => ({ collection: mockCollection })) };
});

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
  levelKind: 'level',
  gradeBand: ['Gr 2', 'Gr 3'],
};

const params = (levelId = 'brampton-level-2-bv-brampton-2025-26') => ({
  params: Promise.resolve({ levelId }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDoc.mockReturnValue({ get: mockGet, update: mockUpdate });
  mockCollection.mockReturnValue({ doc: mockDoc });
  mockGet.mockResolvedValue({ exists: true, data: () => EXISTING });
  mockUpdate.mockResolvedValue(undefined);
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
});
