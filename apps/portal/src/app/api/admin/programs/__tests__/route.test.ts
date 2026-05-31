import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

// ── Firestore mock ─────────────────────────────────────────────────────────────
const mockGet = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockOrderBy = vi.fn();
const mockWhere = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const Timestamp = {
    now: () => ({ toDate: () => new Date() }),
    fromDate: (d: Date) => ({ toDate: () => d }),
  };
  const FieldValue = { serverTimestamp: () => 'SERVER_TS' };
  return {
    Timestamp,
    FieldValue,
    portalFirestore: vi.fn(() => ({ collection: mockCollection })),
  };
});

// Mock getProgram used in [key]/route
const mockGetProgram = vi.fn();
vi.mock('@/features/setu/programs/get-programs', () => ({
  getProgram: (...a: unknown[]) => mockGetProgram(...a),
  listPrograms: vi.fn().mockResolvedValue([]),
}));

function makeRequest(method: string, body?: unknown, uid?: string, role = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-portal-role': role };
  if (uid) headers['x-portal-uid'] = uid;
  return new Request('http://localhost/api/admin/programs', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function makeTimestamp(d: Date) {
  return { toDate: () => d };
}

const validCreateBody = {
  programKey: 'tabla',
  label: 'Tabla Classes',
  shortDescription: 'Learn tabla drumming',
  status: 'active',
  locations: ['Brampton'],
  termType: 'term',
  eligibility: { memberType: 'any' },
  capabilities: {
    usesOfferings: true,
    usesDonation: false,
    usesLevels: false,
    usesCalendar: false,
    attendanceMode: 'none',
  },
  displayOrder: 1,
};

beforeEach(() => {
  vi.clearAllMocks();

  mockOrderBy.mockReturnValue({ get: mockGet });
  mockWhere.mockReturnThis();
  mockDoc.mockReturnValue({ create: mockCreate, update: mockUpdate, get: mockGet });
  mockCollection.mockReturnValue({
    orderBy: mockOrderBy,
    where: mockWhere,
    doc: mockDoc,
    get: mockGet,
  });
  mockGet.mockResolvedValue({ docs: [] });
  mockCreate.mockResolvedValue(undefined);
  mockUpdate.mockResolvedValue(undefined);
  mockGetProgram.mockResolvedValue({ programKey: 'tabla', label: 'Tabla Classes', status: 'active' });
});

// ── GET /api/admin/programs ───────────────────────────────────────────────────

describe('GET /api/admin/programs', () => {
  it('returns 401 when there is no session (no x-portal-role header)', async () => {
    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/admin/programs', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('no-session');
  });

  it('returns 403 for non-admin role', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET', undefined, undefined, 'family-manager'));
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('admin-required');
  });

  it('returns 200 with empty programs array when collection is empty', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);
    const body = await res.json() as { programs: unknown[] };
    expect(body.programs).toEqual([]);
  });

  it('returns 200 with serialized programs', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const programData = {
      programKey: 'bala-vihar',
      label: 'Bala Vihar',
      shortDescription: 'Sunday classes',
      status: 'active',
      locations: ['Brampton'],
      termType: 'term',
      eligibility: { memberType: 'child' },
      capabilities: { usesOfferings: true, usesDonation: true, usesLevels: true, usesCalendar: true, attendanceMode: 'check-in' },
      displayOrder: 0,
      createdAt: makeTimestamp(now),
      createdBy: 'uid-admin',
      updatedAt: makeTimestamp(now),
      updatedBy: 'uid-admin',
    };
    mockOrderBy.mockReturnValue({
      get: vi.fn().mockResolvedValue({ docs: [{ data: () => programData }] }),
    });

    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);
    const body = await res.json() as { programs: Array<{ programKey: string; createdAt: string }> };
    expect(body.programs).toHaveLength(1);
    expect(body.programs[0]!.programKey).toBe('bala-vihar');
    expect(typeof body.programs[0]!.createdAt).toBe('string');
  });
});

// ── POST /api/admin/programs ──────────────────────────────────────────────────

describe('POST /api/admin/programs', () => {
  it('returns 403 for non-admin role', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validCreateBody, 'uid-admin', 'family-manager'));
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('admin-required');
  });

  it('returns 401 when no x-portal-uid header', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validCreateBody));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('no-session');
  });

  it('returns 400 when body is invalid JSON', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/admin/programs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-portal-uid': 'uid-admin', 'x-portal-role': 'admin' },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when required fields are missing', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { label: 'Missing programKey' }, 'uid-admin'));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('bad-request');
  });

  it('returns 201 with programKey on success', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validCreateBody, 'uid-admin'));
    expect(res.status).toBe(201);
    const body = await res.json() as { programKey: string };
    expect(body.programKey).toBe('tabla');
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('derives programKey from label when not supplied', async () => {
    const { POST } = await import('../route');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { programKey, ...withoutKey } = validCreateBody;
    const res = await POST(makeRequest('POST', { ...withoutKey, label: 'Gita Chanting' }, 'uid-admin'));
    expect(res.status).toBe(201);
    const body = await res.json() as { programKey: string };
    expect(body.programKey).toBe('gita-chanting');
  });

  it('returns 409 when create() throws ALREADY_EXISTS (code 6)', async () => {
    const alreadyExists = Object.assign(new Error('Document already exists'), { code: 6 });
    mockDoc.mockReturnValue({ create: vi.fn().mockRejectedValue(alreadyExists), get: mockGet });

    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', validCreateBody, 'uid-admin'));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('programKey-conflict');
  });

  it('revalidates programs tag on success', async () => {
    const { revalidateTag } = await import('next/cache');
    const { POST } = await import('../route');
    await POST(makeRequest('POST', validCreateBody, 'uid-admin'));
    expect(revalidateTag).toHaveBeenCalledWith('programs', 'max');
  });
});

// ── PATCH /api/admin/programs/[key] ──────────────────────────────────────────

describe('PATCH /api/admin/programs/[key]', () => {
  function makeKeyRequest(method: string, key: string, body?: unknown, uid?: string, role = 'admin'): [Request, { params: Promise<{ key: string }> }] {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-portal-role': role };
    if (uid) headers['x-portal-uid'] = uid;
    const req = new Request(`http://localhost/api/admin/programs/${key}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return [req, { params: Promise.resolve({ key }) }];
  }

  it('returns 403 for non-admin role', async () => {
    const { PATCH } = await import('../[key]/route');
    const [req, ctx] = makeKeyRequest('PATCH', 'tabla', { label: 'Updated' }, 'uid-admin', 'family-manager');
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(403);
  });

  it('returns 401 when no x-portal-uid header', async () => {
    const { PATCH } = await import('../[key]/route');
    const [req, ctx] = makeKeyRequest('PATCH', 'tabla', { label: 'Updated' });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 404 when program does not exist', async () => {
    mockGetProgram.mockResolvedValue(null);
    const { PATCH } = await import('../[key]/route');
    const [req, ctx] = makeKeyRequest('PATCH', 'nonexistent', { label: 'X' }, 'uid-admin');
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not-found');
  });

  it('returns 200 and revalidates both tags on success', async () => {
    mockDoc.mockReturnValue({ update: mockUpdate, get: mockGet });
    const { revalidateTag } = await import('next/cache');
    const { PATCH } = await import('../[key]/route');
    const [req, ctx] = makeKeyRequest('PATCH', 'tabla', { label: 'Updated Tabla' }, 'uid-admin');
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith('programs', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('program-tabla', 'max');
  });

  it('returns 400 when body is invalid', async () => {
    const { PATCH } = await import('../[key]/route');
    const [req, ctx] = makeKeyRequest('PATCH', 'tabla', { displayOrder: 'not-a-number' }, 'uid-admin');
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
  });
});
