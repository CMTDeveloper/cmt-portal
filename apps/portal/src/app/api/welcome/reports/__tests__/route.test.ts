import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  buildEnrollmentReport,
  buildAttendanceReport,
  buildRosterCsvRows,
  rosterToCsv,
} = vi.hoisted(() => ({
  buildEnrollmentReport: vi.fn(),
  buildAttendanceReport: vi.fn(),
  buildRosterCsvRows: vi.fn(),
  rosterToCsv: vi.fn(),
}));
vi.mock('@/features/setu/reports/enrollment-report', () => ({ buildEnrollmentReport }));
vi.mock('@/features/setu/reports/attendance-report', () => ({ buildAttendanceReport }));
vi.mock('@/features/setu/roster/build-csv-rows', () => ({ buildRosterCsvRows }));
vi.mock('@/features/setu/roster/roster-csv', () => ({ rosterToCsv }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

import { GET } from '../[kind]/route';

function req(url: string, headers: Record<string, string>): Request {
  return new Request(`https://x${url}`, { headers });
}
// ADMIN, not welcome-team. This suite used to sign in as welcome-team and
// assert 200, which passed because the HANDLER still accepted the role after
// the 2026-08-03 narrowing moved the middleware rule to isAdmin. The route was
// therefore unreachable in production while its tests exercised a path no real
// caller could take - a test suite agreeing with the looser of two disagreeing
// gates. The handler is isAdmin now and this persona matches it.
const ADMIN = { 'x-portal-role': 'admin', 'x-portal-extra-roles': '' };
const WELCOME = { 'x-portal-role': 'welcome-team', 'x-portal-extra-roles': '' };
const FAMILY = { 'x-portal-role': 'family-member', 'x-portal-extra-roles': '' };

function call(url: string, headers: Record<string, string>, kind: string) {
  return GET(req(url, headers), { params: Promise.resolve({ kind }) });
}

const ENROLLMENT_REPORT = {
  byProgram: [], byLevel: [], totalActiveEnrollments: 0, totalMembers: 0,
};

beforeEach(() => {
  buildEnrollmentReport.mockReset();
  buildAttendanceReport.mockReset();
  buildRosterCsvRows.mockReset();
  rosterToCsv.mockReset();
});

describe('GET /api/welcome/reports/[kind]', () => {
  it('401 with no session header', async () => {
    const res = await call('/api/welcome/reports/enrollment', {}, 'enrollment');
    expect(res.status).toBe(401);
  });

  it('403 for a family role on enrollment', async () => {
    const res = await call('/api/welcome/reports/enrollment', FAMILY, 'enrollment');
    expect(res.status).toBe(403);
  });

  it('400 on the removed donations kind', async () => {
    const res = await call('/api/welcome/reports/donations', ADMIN, 'donations');
    expect(res.status).toBe(400);
  });

  // Same gate-3 gap as /api/welcome/prasad/upcoming: middleware has denied
  // welcome-team since 2026-08-03 while the handler still accepted it. Reports
  // carry every family's enrolment data, so the handler asserting its own
  // isAdmin rule - rather than trusting middleware - is the point.
  it('403 for welcome-team - reports are admin-only, at the handler too', async () => {
    const res = await call('/api/welcome/reports/enrollment', WELCOME, 'enrollment');
    expect(res.status).toBe(403);
  });

  it('200 returns enrollment report JSON for an admin', async () => {
    buildEnrollmentReport.mockResolvedValue(ENROLLMENT_REPORT);
    const res = await call('/api/welcome/reports/enrollment', ADMIN, 'enrollment');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ENROLLMENT_REPORT);
  });

  it('enrollment format=csv streams text/csv via the roster export', async () => {
    buildRosterCsvRows.mockResolvedValue([]);
    rosterToCsv.mockReturnValue('familyName,memberName\n');
    const res = await call('/api/welcome/reports/enrollment?format=csv', ADMIN, 'enrollment');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(buildRosterCsvRows).toHaveBeenCalled();
    expect(await res.text()).toContain('familyName');
  });

  it('400 on an unknown report kind', async () => {
    const res = await call('/api/welcome/reports/bogus', ADMIN, 'bogus');
    expect(res.status).toBe(400);
  });
});
