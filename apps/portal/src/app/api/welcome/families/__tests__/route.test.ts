import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listRosterFamilies, buildRosterCsvRows } = vi.hoisted(() => ({
  listRosterFamilies: vi.fn(),
  buildRosterCsvRows: vi.fn(),
}));
vi.mock('@/features/setu/roster/list-families', () => ({ listRosterFamilies }));
vi.mock('@/features/setu/roster/build-csv-rows', () => ({ buildRosterCsvRows }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

import { GET } from '../route';

function req(url: string, headers: Record<string, string>): Request {
  return new Request(`https://x${url}`, { headers });
}
const WELCOME = { 'x-portal-role': 'welcome-team', 'x-portal-extra-roles': '' };

beforeEach(() => {
  listRosterFamilies.mockReset();
  buildRosterCsvRows.mockReset();
});

describe('GET /api/welcome/families', () => {
  it('401 with no session header', async () => {
    const res = await GET(req('/api/welcome/families', {}));
    expect(res.status).toBe(401);
  });

  it('403 for a family role', async () => {
    const res = await GET(
      req('/api/welcome/families', { 'x-portal-role': 'family-member', 'x-portal-extra-roles': '' }),
    );
    expect(res.status).toBe(403);
  });

  it('200 returns the roster list JSON for welcome-team', async () => {
    listRosterFamilies.mockResolvedValue({ families: [{ fid: 'CMT-X' }], nextCursor: null, total: 1 });
    const res = await GET(req('/api/welcome/families?limit=50', WELCOME));
    expect(res.status).toBe(200);
    expect((await res.json()).families).toHaveLength(1);
  });

  it('format=csv streams text/csv with a one-row-per-person body', async () => {
    buildRosterCsvRows.mockResolvedValue([
      {
        familyName: 'Patel',
        fid: 'CMT-X',
        legacyFid: '1',
        memberName: 'Ravi Patel',
        type: 'Child',
        grade: '3',
        location: 'Brampton',
        programs: '',
        payment: 'paid',
      },
    ]);
    const res = await GET(req('/api/welcome/families?format=csv', WELCOME));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(await res.text()).toContain('Ravi Patel');
  });

  it('400 on an invalid query param (unknown location)', async () => {
    const res = await GET(req('/api/welcome/families?location=Toronto', WELCOME));
    expect(res.status).toBe(400);
  });
});
