import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

const mockGetFamilyByFid = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-family-by-fid', () => ({
  getFamilyByFid: mockGetFamilyByFid,
}));

const mockLoad = vi.hoisted(() => vi.fn());
vi.mock('@/app/family/_helpers/load-dashboard', () => ({
  loadFamilyDashboard: mockLoad,
}));

const mockGetLiveSchoolYear = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/rollover/live-school-year', () => ({
  getLiveSchoolYearCached: mockGetLiveSchoolYear,
}));

import { GET } from '../route';

const family = { fid: 'CMT-AB12CD34', publicFid: '1042', name: 'Patel', location: 'Brampton', legacyFid: null };
const members = [
  { mid: 'CMT-AB12CD34-01', publicMid: '50001', firstName: 'Raj', lastName: 'Patel', type: 'Adult' },
  { mid: 'CMT-AB12CD34-02', publicMid: '50002', firstName: 'Anya', lastName: 'Patel', type: 'Child' },
];

const dashboardData = {
  model: {
    isEnrolled: true,
    kidsEnrolled: 1,
    enrollPeriodLabel: '2025-26',
    suggestedAmount: 500,
    givenForPeriod: 200,
    donation: { complete: false, pct: 40, tone: 'warn', showGive: true, showProgress: true, heading: 'Donation pending' },
    isLegacyPeriod: false,
    legacyPaid: false,
    otherProgramCards: [{ eid: 'e2', programKey: 'tabla', label: 'Tabla', termLabel: '2025-26', status: 'active', showAttendance: false, showDonation: true }],
  },
  upcoming: [{ entryId: 'x', date: '2026-01-11', kind: 'class', classType: 'regular', specialEvents: null }],
  seva: { currentSevaYear: '2025-26', hoursPerYear: 20, hoursEarned: 4 },
  prasad: { paid: 'p-1', pid: 'pid', date: '2026-03-01', youngestName: 'Anya', birthMonth: 3, reason: "Anya's birthday month", status: 'proposed', movable: true },
};

// Header-based session (cookie AND Bearer/mobile callers).
function makeRequest(session?: { role: string; fid: string; mid: string }) {
  const headers = new Headers();
  if (session) {
    headers.set('x-portal-role', session.role);
    headers.set('x-portal-uid', `uid-${session.mid}`);
    headers.set('x-portal-fid', session.fid);
    headers.set('x-portal-mid', session.mid);
  }
  return new Request('http://localhost/api/setu/dashboard', { method: 'GET', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFamilyByFid.mockResolvedValue({ family, members });
  mockLoad.mockResolvedValue(dashboardData);
  mockGetLiveSchoolYear.mockResolvedValue('2025-26');
});

describe('GET /api/setu/dashboard', () => {
  it('returns 401 when no session headers', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 for a non-family role', async () => {
    const res = await GET(makeRequest({ role: 'welcome-team', fid: 'CMT-AB12CD34', mid: 'x' }));
    expect(res.status).toBe(401);
  });

  it('returns the dashboard aggregate for a family member', async () => {
    const res = await GET(makeRequest({ role: 'family-member', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-02' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.family.fid).toBe('CMT-AB12CD34');
    // Public 4-digit FID is exposed at family level alongside the join-key `fid` (issue #4).
    expect(body.family.publicFid).toBe('1042');
    expect(body.currentMid).toBe('CMT-AB12CD34-02');
    expect(body.isManager).toBe(false);
    expect(body.members).toHaveLength(2);
    // Each member carries its 5-digit publicMid alongside the join-key `mid`.
    expect(body.members[0].publicMid).toBe('50001');
    expect(body.members[1].publicMid).toBe('50002');
    expect(body.members[0].mid).toBe('CMT-AB12CD34-01');
    expect(body.balaVihar.suggestedAmount).toBe(500);
    expect(body.balaVihar.givenForPeriod).toBe(200);
    expect(body.balaVihar.donationPct).toBe(40);
    // Attendance is no longer a family-level / dashboard concept (#3).
    expect(body.balaVihar.attendance).toBeUndefined();
    expect(body.otherPrograms[0].programKey).toBe('tabla');
    expect(body.upcoming[0].date).toBe('2026-01-11');
    expect(body.seva.hoursEarned).toBe(4);
    expect(body.prasad.status).toBe('proposed');
    // Top-level live school year (mobile counterpart of the web SchoolYearBadge),
    // distinct from balaVihar.termLabel (the family's enrollment period).
    expect(body.schoolYear).toBe('2025-26');
  });

  it('serializes publicFid/publicMid as null when not yet assigned (fallback case)', async () => {
    // Pre-migration families/members have no publicFid/publicMid — the route must
    // still emit the key as `null` (additive, never undefined / absent) so the
    // mobile client can do its own `publicX ?? legacyX` fallback.
    mockGetFamilyByFid.mockResolvedValue({
      family: { fid: 'CMT-AB12CD34', publicFid: null, name: 'Patel', location: 'Brampton', legacyFid: null },
      members: [{ mid: 'CMT-AB12CD34-01', publicMid: null, firstName: 'Raj', lastName: 'Patel', type: 'Adult' }],
    });
    const res = await GET(makeRequest({ role: 'family-manager', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-01' }));
    const body = await res.json();
    expect(body.family.publicFid).toBeNull();
    expect('publicFid' in body.family).toBe(true);
    expect(body.members[0].publicMid).toBeNull();
    expect('publicMid' in body.members[0]).toBe(true);
  });

  it('does NOT leak UI-only fields (pill colors, donateUrl)', async () => {
    const res = await GET(makeRequest({ role: 'family-manager', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-01' }));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('var(--');
    expect(body.donateUrl).toBeUndefined();
    expect(body.balaVihar.enrolledPill).toBeUndefined();
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { GET: flaggedGET } = await import('../route');
    const res = await flaggedGET(makeRequest({ role: 'family-manager', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-01' }));
    expect(res.status).toBe(404);
  });
});
