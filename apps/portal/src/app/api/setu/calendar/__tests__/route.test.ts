import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPublished, mockWeekly } = vi.hoisted(() => ({ mockPublished: vi.fn(), mockWeekly: vi.fn() }));
vi.mock('@/features/setu/calendar/calendar', () => ({
  getPublishedCalendar: mockPublished,
  getWeeklySchedule: mockWeekly,
}));

function req(url: string, role?: string): Request {
  const headers: Record<string, string> = {};
  if (role) headers['x-portal-role'] = role;
  if (role) headers['x-portal-uid'] = 'uid-x';
  return new Request(`http://localhost${url}`, { method: 'GET', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPublished.mockResolvedValue([{ entryId: 'brampton-2025-09-07', date: '2025-09-07', kind: 'class' }]);
  mockWeekly.mockResolvedValue([{ time: '10:00', label: 'Assembly' }]);
});

describe('GET /api/setu/calendar', () => {
  it('401 without a session', async () => {
    const { GET } = await import('../route');
    expect((await GET(req('/api/setu/calendar?location=Brampton'))).status).toBe(401);
  });
  it('allows a family-member to read published entries + weekly', async () => {
    const { GET } = await import('../route');
    const res = await GET(req('/api/setu/calendar?location=Brampton', 'family-member'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.weekly).toEqual([{ time: '10:00', label: 'Assembly' }]);
    // Defaults to the Bala Vihar program when no ?programKey= is given.
    expect(mockPublished).toHaveBeenCalledWith('Brampton', 'bala-vihar');
  });
  it('honors an explicit ?programKey= for a non-BV program', async () => {
    const { GET } = await import('../route');
    const res = await GET(req('/api/setu/calendar?location=Brampton&programKey=tabla', 'family-member'));
    expect(res.status).toBe(200);
    expect((await res.json()).programKey).toBe('tabla');
    expect(mockPublished).toHaveBeenCalledWith('Brampton', 'tabla');
  });
  it('allows a teacher to read', async () => {
    const { GET } = await import('../route');
    expect((await GET(req('/api/setu/calendar?location=Brampton', 'teacher'))).status).toBe(200);
  });
  it('400 without a valid location', async () => {
    const { GET } = await import('../route');
    expect((await GET(req('/api/setu/calendar', 'family-manager'))).status).toBe(400);
  });
});
