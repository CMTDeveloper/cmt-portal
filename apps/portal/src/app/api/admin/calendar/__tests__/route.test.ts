import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate, mockGetSerialized } = vi.hoisted(() => ({ mockCreate: vi.fn(), mockGetSerialized: vi.fn() }));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  portalFirestore: () => ({ collection: () => ({ doc: () => ({ create: mockCreate }) }) }),
}));
vi.mock('@/features/setu/calendar/calendar', () => ({ getCalendarSerialized: mockGetSerialized }));

// The past-year guard resolves the live year via getSchoolYearConfig.
const { mockGetSchoolYearConfig } = vi.hoisted(() => ({ mockGetSchoolYearConfig: vi.fn() }));
vi.mock('@/features/setu/rollover/school-year-config', () => ({
  getSchoolYearConfig: mockGetSchoolYearConfig,
}));
// The GET route now validates `location` against the admin-managed centre list.
vi.mock('@/lib/locations', () => ({
  getLocationOptions: vi.fn().mockResolvedValue(['Brampton', 'Scarborough']),
}));

function makeRequest(method: string, url: string, body?: unknown, uid?: string, role = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-portal-role': role };
  if (uid) headers['x-portal-uid'] = uid;
  return new Request(`http://localhost${url}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

const classBody = { location: 'Brampton', date: '2025-09-07', kind: 'class', classType: 'first' };

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue(undefined);
  mockGetSerialized.mockResolvedValue([]);
  mockGetSchoolYearConfig.mockResolvedValue({ currentYear: '2025-26' });
});

describe('GET /api/admin/calendar', () => {
  it('403 for family-manager', async () => {
    const { GET } = await import('../route');
    expect((await GET(makeRequest('GET', '/api/admin/calendar?location=Brampton', undefined, 'uid-m', 'family-manager'))).status).toBe(403);
  });
  it('allows welcome-team', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET', '/api/admin/calendar?location=Brampton', undefined, 'uid-w', 'welcome-team'));
    expect(res.status).toBe(200);
    expect(mockGetSerialized).toHaveBeenCalledWith('Brampton');
  });
  it('400 without a valid location', async () => {
    const { GET } = await import('../route');
    expect((await GET(makeRequest('GET', '/api/admin/calendar', undefined, 'uid-a'))).status).toBe(400);
  });
});

describe('POST /api/admin/calendar', () => {
  it('401 without uid', async () => {
    const { POST } = await import('../route');
    expect((await POST(makeRequest('POST', '/api/admin/calendar', classBody))).status).toBe(401);
  });
  it('allows welcome-team to create a class day → 201 entryId (programKey-scoped)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', '/api/admin/calendar', classBody, 'uid-w', 'welcome-team'));
    expect(res.status).toBe(201);
    // id is now {programKey}-{location}-{date}; programKey defaults to bala-vihar.
    expect((await res.json()).entryId).toBe('bala-vihar-brampton-2025-09-07');
  });
  it('gives two programs distinct ids on the same location+date (#1: no collision)', async () => {
    const { POST } = await import('../route');
    const bv = await POST(makeRequest('POST', '/api/admin/calendar', classBody, 'uid-a'));
    const tabla = await POST(
      makeRequest('POST', '/api/admin/calendar', { ...classBody, programKey: 'tabla' }, 'uid-a'),
    );
    expect((await bv.json()).entryId).toBe('bala-vihar-brampton-2025-09-07');
    expect((await tabla.json()).entryId).toBe('tabla-brampton-2025-09-07');
  });
  it('persists prasadNeeded (defaults true when omitted)', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest('POST', '/api/admin/calendar', classBody, 'uid-a'));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ prasadNeeded: true }));
  });
  it('persists prasadNeeded:false from the body (script/API "No prasad" day stays excluded)', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest('POST', '/api/admin/calendar', { ...classBody, prasadNeeded: false }, 'uid-a'));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ prasadNeeded: false }));
  });
  it('400 for a class day with no classType', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', '/api/admin/calendar', { location: 'Brampton', date: '2025-09-07', kind: 'class' }, 'uid-a'));
    expect(res.status).toBe(400);
  });
  it('409 on duplicate entry (code 6)', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('exists'), { code: 6 }));
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', '/api/admin/calendar', classBody, 'uid-a'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('entry-conflict');
  });
  it('409 past-year when the date falls in a past school year', async () => {
    // live = 2025-26; a 2024-09-07 date is the 2024-25 (past) year.
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', '/api/admin/calendar', { ...classBody, date: '2024-09-07' }, 'uid-a'));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'past-year', year: '2024-25', liveYear: '2025-26' });
    expect(mockCreate).not.toHaveBeenCalled();
  });
  it('does NOT reject a live-year date (proceeds to create)', async () => {
    // classBody.date = 2025-09-07 → 2025-26 (live).
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', '/api/admin/calendar', classBody, 'uid-a'));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalled();
  });
});
