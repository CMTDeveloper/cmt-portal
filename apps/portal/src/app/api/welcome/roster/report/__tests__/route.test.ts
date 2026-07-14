import { describe, it, expect, vi, beforeEach } from 'vitest';

const { buildRosterReportDataset } = vi.hoisted(() => ({ buildRosterReportDataset: vi.fn() }));
vi.mock('@/features/setu/roster/report-dataset', () => ({ buildRosterReportDataset }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

import { GET } from '../route';

function req(url: string, headers: Record<string, string>): Request {
  return new Request(`https://x${url}`, { headers });
}
const WELCOME = { 'x-portal-role': 'welcome-team', 'x-portal-extra-roles': '' };

const SAMPLE = [
  {
    row: {
      fid: 'CMT-RANA', publicFid: '1075', legacyFid: '477', name: 'Rana', location: 'Brampton',
      memberCount: 2, payment: 'paid', programs: ['Bala Vihar'], programKeys: ['bala-vihar'],
      bvChildren: [{ grade: '2', levelName: 'Level 2' }],
    },
    personRows: [
      { familyName: 'Rana', fid: 'CMT-RANA', legacyFid: '477', memberName: 'Harshita Rana', type: 'Child', grade: '2', level: 'Level 2', location: 'Brampton', programs: 'Bala Vihar', payment: 'paid' },
    ],
  },
  {
    row: {
      fid: 'CMT-SHAH', publicFid: '1200', legacyFid: null, name: 'Shah', location: 'Scarborough',
      memberCount: 1, payment: 'outstanding', programs: ['Bala Vihar'], programKeys: ['bala-vihar'],
      bvChildren: [{ grade: '5', levelName: 'Level 4' }],
    },
    personRows: [
      { familyName: 'Shah', fid: 'CMT-SHAH', legacyFid: '', memberName: 'Aarav Shah', type: 'Child', grade: '5', level: 'Level 4', location: 'Scarborough', programs: 'Bala Vihar', payment: 'outstanding' },
    ],
  },
];

beforeEach(() => buildRosterReportDataset.mockReset());

describe('GET /api/welcome/roster/report', () => {
  it('401 with no session header', async () => {
    const res = await GET(req('/api/welcome/roster/report', {}));
    expect(res.status).toBe(401);
  });

  it('403 for a family role', async () => {
    const res = await GET(req('/api/welcome/roster/report', { 'x-portal-role': 'family-member', 'x-portal-extra-roles': '' }));
    expect(res.status).toBe(403);
  });

  it('200 returns lean rows for welcome-team', async () => {
    buildRosterReportDataset.mockResolvedValue(SAMPLE);
    const res = await GET(req('/api/welcome/roster/report', WELCOME));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0]).not.toHaveProperty('personRows'); // lean projection
    expect(body.rows[0].bvChildren).toEqual([{ grade: '2', levelName: 'Level 2' }]);
  });

  it('format=csv honors a level filter and includes the level column header', async () => {
    buildRosterReportDataset.mockResolvedValue(SAMPLE);
    const res = await GET(req('/api/welcome/roster/report?format=csv&level=Level%204', WELCOME));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const body = await res.text();
    expect(body).toContain('familyName,fid,legacyFid,memberName,type,grade,level,location,programs,payment');
    expect(body).toContain('Aarav Shah');   // Level 4 kid included
    expect(body).not.toContain('Harshita Rana'); // Level 2 kid filtered out
  });
});
