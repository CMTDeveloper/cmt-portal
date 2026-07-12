import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/locations', () => ({
  getLocationOptions: vi.fn(),
  setLocationOptions: vi.fn(),
}));
vi.mock('@/features/setu/locations/referenced-locations', () => ({
  countLocationReferences: vi.fn(),
}));

import { GET, PUT } from '../route';
import { getLocationOptions, setLocationOptions } from '@/lib/locations';
import { countLocationReferences } from '@/features/setu/locations/referenced-locations';

function req(method: string, body?: unknown, role: string | null = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  return new Request('http://localhost/api/admin/locations', {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLocationOptions).mockResolvedValue(['Brampton', 'Scarborough']);
  vi.mocked(setLocationOptions).mockResolvedValue(undefined);
  vi.mocked(countLocationReferences).mockResolvedValue(0);
});

describe('GET /api/admin/locations', () => {
  it('401 without a session', async () => expect((await GET(req('GET', undefined, null))).status).toBe(401));
  it('403 for a non-admin', async () => expect((await GET(req('GET', undefined, 'family-manager'))).status).toBe(403));
  it('200 with options for an admin', async () => {
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).options).toEqual(['Brampton', 'Scarborough']);
  });
});

describe('PUT /api/admin/locations', () => {
  it('403 for a non-admin and does not write', async () => {
    const res = await PUT(req('PUT', { options: ['Brampton'] }, 'family-manager'));
    expect(res.status).toBe(403);
    expect(setLocationOptions).not.toHaveBeenCalled();
  });
  it('400 when the resulting list is empty', async () => {
    const res = await PUT(req('PUT', { options: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'empty-list' });
    expect(setLocationOptions).not.toHaveBeenCalled();
  });
  it('400 when an option is blank after trimming', async () => {
    expect((await PUT(req('PUT', { options: ['   '] }))).status).toBe(400);
  });
  it('adds a new centre and trims/dedupes (case-insensitive)', async () => {
    const res = await PUT(req('PUT', { options: ['  Brampton ', 'brampton', 'Scarborough', 'Oakville'] }));
    expect(res.status).toBe(200);
    expect(setLocationOptions).toHaveBeenCalledWith(['Brampton', 'Scarborough', 'Oakville']);
  });
  it('removes an unused centre', async () => {
    // current = [Brampton, Scarborough]; new drops Scarborough; Scarborough unused
    vi.mocked(countLocationReferences).mockResolvedValue(0);
    const res = await PUT(req('PUT', { options: ['Brampton'] }));
    expect(res.status).toBe(200);
    expect(setLocationOptions).toHaveBeenCalledWith(['Brampton']);
  });
  it('409 refusing to remove a referenced centre', async () => {
    vi.mocked(countLocationReferences).mockResolvedValue(714); // Scarborough referenced
    const res = await PUT(req('PUT', { options: ['Brampton'] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'location-in-use', location: 'Scarborough', count: 714 });
    expect(setLocationOptions).not.toHaveBeenCalled();
  });
});
