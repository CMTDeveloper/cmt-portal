import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/seva-requirement', () => ({ getSevaRequirement: vi.fn() }));
vi.mock('@/features/setu/seva/get-opportunities', () => ({
  listOpportunities: vi.fn(),
  serializeOpportunity: vi.fn((o: unknown) => o),
}));
const mockSet = vi.fn();
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ collection: () => ({ doc: () => ({ set: mockSet }) }) }),
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

import { GET, POST } from '../route';
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listOpportunities } from '@/features/setu/seva/get-opportunities';

function req(method: string, body?: unknown, role: string | null = 'welcome-team', uid: string | null = 'u-staff'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  if (uid) headers['x-portal-uid'] = uid;
  return new Request('http://localhost/api/welcome/seva/opportunities', {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const valid = { title: 'Diwali setup', date: '2026-01-01', defaultHours: 4 };

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockResolvedValue(undefined);
  vi.mocked(getSevaRequirement).mockResolvedValue({ hoursPerYear: 20, currentSevaYear: '2025-26' });
  vi.mocked(listOpportunities).mockResolvedValue([]);
});

describe('GET /api/welcome/seva/opportunities', () => {
  it('401 without session', async () => { expect((await GET(req('GET', undefined, null))).status).toBe(401); });
  it('403 for family-manager', async () => { expect((await GET(req('GET', undefined, 'family-manager'))).status).toBe(403); });
  it('200 for welcome-team', async () => {
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).opportunities).toEqual([]);
  });
  it('200 for admin', async () => { expect((await GET(req('GET', undefined, 'admin'))).status).toBe(200); });
});

describe('POST /api/welcome/seva/opportunities', () => {
  it('401 when uid header missing', async () => { expect((await POST(req('POST', valid, 'welcome-team', null))).status).toBe(401); });
  it('403 for family-manager', async () => {
    expect((await POST(req('POST', valid, 'family-manager'))).status).toBe(403);
    expect(mockSet).not.toHaveBeenCalled();
  });
  it('400 on invalid body', async () => { expect((await POST(req('POST', {}))).status).toBe(400); });
  it('400 when seva year is not set', async () => {
    vi.mocked(getSevaRequirement).mockResolvedValue({ hoursPerYear: 20, currentSevaYear: null });
    const res = await POST(req('POST', valid));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('seva-year-not-set');
  });
  it('201 stamps sevaYear + open status on success', async () => {
    const res = await POST(req('POST', valid));
    expect(res.status).toBe(201);
    expect((await res.json()).oppId).toBeTruthy();
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Diwali setup', defaultHours: 4, sevaYear: '2025-26', status: 'open', createdBy: 'u-staff',
    }));
  });
});
