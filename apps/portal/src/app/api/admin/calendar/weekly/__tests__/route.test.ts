import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSet, mockWeekly } = vi.hoisted(() => ({ mockSet: vi.fn(), mockWeekly: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  portalFirestore: () => ({ collection: () => ({ doc: () => ({ set: mockSet }) }) }),
}));
vi.mock('@/features/setu/calendar/calendar', () => ({ getWeeklySchedule: mockWeekly }));
// The GET route now validates `location` against the admin-managed centre list.
vi.mock('@/lib/locations', () => ({
  getLocationOptions: vi.fn().mockResolvedValue(['Brampton', 'Scarborough']),
}));

function req(method: string, url: string, body?: unknown, uid = 'uid-a', role = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-portal-role': role };
  if (uid) headers['x-portal-uid'] = uid;
  return new Request(`http://localhost${url}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockResolvedValue(undefined);
  mockWeekly.mockResolvedValue([{ time: '10:00', label: 'Assembly' }]);
});

describe('GET /api/admin/calendar/weekly', () => {
  it('returns rows for a location (welcome-team)', async () => {
    const { GET } = await import('../route');
    const res = await GET(req('GET', '/api/admin/calendar/weekly?location=Brampton', undefined, 'uid-w', 'welcome-team'));
    expect(res.status).toBe(200);
    expect((await res.json()).rows).toEqual([{ time: '10:00', label: 'Assembly' }]);
  });
  it('400 without a valid location', async () => {
    const { GET } = await import('../route');
    expect((await GET(req('GET', '/api/admin/calendar/weekly', undefined, 'uid-a'))).status).toBe(400);
  });
});

describe('PUT /api/admin/calendar/weekly', () => {
  it('saves rows for a location', async () => {
    const { PUT } = await import('../route');
    const res = await PUT(req('PUT', '/api/admin/calendar/weekly', { location: 'Brampton', rows: [{ time: '10:00', label: 'Assembly' }] }, 'uid-w', 'welcome-team'));
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ location: 'Brampton', updatedBy: 'uid-w' }));
  });
  it('403 for family-manager', async () => {
    const { PUT } = await import('../route');
    expect((await PUT(req('PUT', '/api/admin/calendar/weekly', { location: 'Brampton', rows: [] }, 'uid-m', 'family-manager'))).status).toBe(403);
  });
  it('400 for a row missing label', async () => {
    const { PUT } = await import('../route');
    expect((await PUT(req('PUT', '/api/admin/calendar/weekly', { location: 'Brampton', rows: [{ time: '10:00' }] }, 'uid-a'))).status).toBe(400);
  });
});
