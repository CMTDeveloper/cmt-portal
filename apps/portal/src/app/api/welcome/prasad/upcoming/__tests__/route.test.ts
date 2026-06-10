import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getUpcomingPrasad } = vi.hoisted(() => ({ getUpcomingPrasad: vi.fn() }));
vi.mock('@/features/setu/prasad/upcoming', () => ({ getUpcomingPrasad }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

import { GET } from '../route';

function req(url: string, headers: Record<string, string>): Request {
  return new Request(`https://x${url}`, { headers });
}
const WELCOME = { 'x-portal-role': 'welcome-team', 'x-portal-extra-roles': '' };

beforeEach(() => {
  getUpcomingPrasad.mockReset();
});

describe('GET /api/welcome/prasad/upcoming', () => {
  it('401 with no session header', async () => {
    const res = await GET(req('/api/welcome/prasad/upcoming', {}));
    expect(res.status).toBe(401);
    expect(getUpcomingPrasad).not.toHaveBeenCalled();
  });

  it('403 for a family role', async () => {
    const res = await GET(
      req('/api/welcome/prasad/upcoming', { 'x-portal-role': 'family-member', 'x-portal-extra-roles': '' }),
    );
    expect(res.status).toBe(403);
    expect(getUpcomingPrasad).not.toHaveBeenCalled();
  });

  it('200 returns the grouped sundays + contacts for welcome-team', async () => {
    getUpcomingPrasad.mockResolvedValue({
      locations: [
        {
          location: 'Brampton',
          sundays: [
            {
              date: '2026-03-08',
              families: [
                { fid: 'F1', familyName: 'Sharma', contacts: [{ name: 'Asha Sharma', email: 'asha@x.com', phone: '(416) 555-1212' }] },
              ],
            },
          ],
        },
        { location: 'Scarborough', sundays: [] },
      ],
    });

    const res = await GET(req('/api/welcome/prasad/upcoming', WELCOME));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      locations: Array<{ location: string; sundays: Array<{ date: string; families: Array<{ fid: string; contacts: unknown[] }> }> }>;
    };
    expect(body.locations.map((l) => l.location)).toEqual(['Brampton', 'Scarborough']);
    expect(body.locations[0]!.sundays[0]!.date).toBe('2026-03-08');
    expect(body.locations[0]!.sundays[0]!.families[0]!.contacts).toEqual([
      { name: 'Asha Sharma', email: 'asha@x.com', phone: '(416) 555-1212' },
    ]);
    expect(body.locations[1]!.sundays).toEqual([]);
  });

  it('404 when the setu auth flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { GET: GuardedGet } = await import('../route');
    const res = await GuardedGet(req('/api/welcome/prasad/upcoming', WELCOME));
    expect(res.status).toBe(404);
    vi.doUnmock('@/lib/flags');
    vi.resetModules();
  });
});
