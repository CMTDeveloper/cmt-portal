import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/seva-requirement', () => ({
  getSevaRequirement: vi.fn(),
  setSevaRequirement: vi.fn(),
}));

import { GET, PUT } from '../route';
import { getSevaRequirement, setSevaRequirement } from '@/lib/seva-requirement';

function req(method: string, body?: unknown, role: string | null = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  return new Request('http://localhost/api/admin/seva/requirement', {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSevaRequirement).mockResolvedValue({ hoursPerYear: 20, currentSevaYear: '2025-26' });
  vi.mocked(setSevaRequirement).mockResolvedValue(undefined);
});

describe('GET /api/admin/seva/requirement', () => {
  it('401 without a session', async () => {
    expect((await GET(req('GET', undefined, null))).status).toBe(401);
  });
  it('403 for non-admin', async () => {
    expect((await GET(req('GET', undefined, 'family-manager'))).status).toBe(403);
  });
  it('200 returns the requirement for admin', async () => {
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).requirement).toEqual({ hoursPerYear: 20, currentSevaYear: '2025-26' });
  });
});

describe('PUT /api/admin/seva/requirement', () => {
  it('403 for non-admin (and does not write)', async () => {
    expect((await PUT(req('PUT', { hoursPerYear: 20, currentSevaYear: '2025-26' }, 'welcome-team'))).status).toBe(403);
    expect(setSevaRequirement).not.toHaveBeenCalled();
  });
  it('400 when hoursPerYear is non-positive', async () => {
    expect((await PUT(req('PUT', { hoursPerYear: 0, currentSevaYear: null }))).status).toBe(400);
  });
  it('400 when currentSevaYear is missing', async () => {
    expect((await PUT(req('PUT', { hoursPerYear: 20 }))).status).toBe(400);
  });
  it('200 persists a valid config (year may be null)', async () => {
    const res = await PUT(req('PUT', { hoursPerYear: 25, currentSevaYear: '2025-26' }));
    expect(res.status).toBe(200);
    expect(setSevaRequirement).toHaveBeenCalledWith({ hoursPerYear: 25, currentSevaYear: '2025-26' });
  });
});
