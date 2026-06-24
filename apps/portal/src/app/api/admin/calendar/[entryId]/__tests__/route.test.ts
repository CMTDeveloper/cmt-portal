import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockUpdate, mockDelete } = vi.hoisted(() => ({ mockGet: vi.fn(), mockUpdate: vi.fn(), mockDelete: vi.fn() }));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  portalFirestore: () => ({ collection: () => ({ doc: () => ({ get: mockGet, update: mockUpdate, delete: mockDelete }) }) }),
}));

// The past-year guard resolves the live year via getSchoolYearConfig.
const { mockGetSchoolYearConfig } = vi.hoisted(() => ({ mockGetSchoolYearConfig: vi.fn() }));
vi.mock('@/features/setu/rollover/school-year-config', () => ({
  getSchoolYearConfig: mockGetSchoolYearConfig,
}));

function req(method: string, body?: unknown, uid = 'uid-a', role = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-portal-role': role };
  if (uid) headers['x-portal-uid'] = uid;
  return new Request('http://localhost/api/admin/calendar/brampton-2025-09-07', { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const params = (entryId = 'brampton-2025-09-07') => ({ params: Promise.resolve({ entryId }) });

const EXISTING = { entryId: 'brampton-2025-09-07', date: '2025-09-07', kind: 'class', classType: 'first', noClassReason: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ exists: true, data: () => EXISTING });
  mockUpdate.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
  mockGetSchoolYearConfig.mockResolvedValue({ currentYear: '2025-26' });
});

describe('PATCH /api/admin/calendar/[entryId]', () => {
  it('allows welcome-team to toggle enabled', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(req('PATCH', { enabled: false }, 'uid-w', 'welcome-team'), params());
    expect(res.status).toBe(200);
    expect((mockUpdate.mock.calls[0]![0] as Record<string, unknown>).enabled).toBe(false);
  });
  it('404 when entry missing', async () => {
    mockGet.mockResolvedValue({ exists: false });
    const { PATCH } = await import('../route');
    expect((await PATCH(req('PATCH', { enabled: true }), params('nope'))).status).toBe(404);
  });
  it('rejects switching to no-class while leaving a classType (existing class + kind=no-class)', async () => {
    const { PATCH } = await import('../route');
    // patch sets kind=no-class but not classType:null → merged classType stays 'first' → 400
    const res = await PATCH(req('PATCH', { kind: 'no-class' }), params());
    expect(res.status).toBe(400);
  });
  it('allows switching to no-class when clearing classType', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(req('PATCH', { kind: 'no-class', classType: null, noClassReason: 'Winter Break' }), params());
    expect(res.status).toBe(200);
  });
  it('403 for family-manager', async () => {
    const { PATCH } = await import('../route');
    expect((await PATCH(req('PATCH', { enabled: false }, 'uid-m', 'family-manager'), params())).status).toBe(403);
  });
  it('409 past-year when the entry is in a past school year', async () => {
    // live = 2025-26; this entry's date is in 2024-25 (past).
    mockGet.mockResolvedValue({ exists: true, data: () => ({ ...EXISTING, date: '2024-09-07' }) });
    const { PATCH } = await import('../route');
    const res = await PATCH(req('PATCH', { enabled: false }), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'past-year', year: '2024-25', liveYear: '2025-26' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it('does NOT reject a live-year entry (updates)', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(req('PATCH', { enabled: false }), params());
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/calendar/[entryId]', () => {
  it('deletes an existing entry', async () => {
    const { DELETE } = await import('../route');
    const res = await DELETE(req('DELETE'), params());
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalled();
  });
  it('404 when entry missing', async () => {
    mockGet.mockResolvedValue({ exists: false });
    const { DELETE } = await import('../route');
    expect((await DELETE(req('DELETE'), params('nope'))).status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });
  it('409 past-year when the entry is in a past school year', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ ...EXISTING, date: '2024-09-07' }) });
    const { DELETE } = await import('../route');
    const res = await DELETE(req('DELETE'), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'past-year', year: '2024-25', liveYear: '2025-26' });
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
