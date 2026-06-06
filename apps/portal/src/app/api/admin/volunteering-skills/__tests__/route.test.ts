import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/volunteering-skills', () => ({
  getVolunteeringSkillOptions: vi.fn(),
  setVolunteeringSkillOptions: vi.fn(),
}));

import { GET, PUT } from '../route';
import { getVolunteeringSkillOptions, setVolunteeringSkillOptions } from '@/lib/volunteering-skills';

function req(method: string, body?: unknown, role: string | null = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  return new Request('http://localhost/api/admin/volunteering-skills', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVolunteeringSkillOptions).mockResolvedValue(['Teaching']);
  vi.mocked(setVolunteeringSkillOptions).mockResolvedValue(undefined);
});

describe('GET /api/admin/volunteering-skills', () => {
  it('returns 401 without a session', async () => {
    const res = await GET(req('GET', undefined, null));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin role', async () => {
    const res = await GET(req('GET', undefined, 'family-manager'));
    expect(res.status).toBe(403);
  });

  it('returns 200 with the current options for an admin', async () => {
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).options).toEqual(['Teaching']);
  });
});

describe('PUT /api/admin/volunteering-skills', () => {
  it('returns 403 for a non-admin role (and does not write)', async () => {
    const res = await PUT(req('PUT', { options: ['A'] }, 'family-manager'));
    expect(res.status).toBe(403);
    expect(setVolunteeringSkillOptions).not.toHaveBeenCalled();
  });

  it('returns 400 when options is missing', async () => {
    const res = await PUT(req('PUT', {}));
    expect(res.status).toBe(400);
  });

  it('returns 400 when an option is blank after trimming', async () => {
    const res = await PUT(req('PUT', { options: ['   '] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when an option exceeds 60 characters', async () => {
    const res = await PUT(req('PUT', { options: ['x'.repeat(61)] }));
    expect(res.status).toBe(400);
  });

  it('persists trimmed, case-insensitively deduped options', async () => {
    const res = await PUT(req('PUT', { options: ['  Teaching  ', 'teaching', 'AV / Tech'] }));
    expect(res.status).toBe(200);
    expect(setVolunteeringSkillOptions).toHaveBeenCalledWith(['Teaching', 'AV / Tech']);
    expect((await res.json()).options).toEqual(['Teaching', 'AV / Tech']);
  });

  it('accepts an empty list (admins clearing all options)', async () => {
    const res = await PUT(req('PUT', { options: [] }));
    expect(res.status).toBe(200);
    expect(setVolunteeringSkillOptions).toHaveBeenCalledWith([]);
  });
});
