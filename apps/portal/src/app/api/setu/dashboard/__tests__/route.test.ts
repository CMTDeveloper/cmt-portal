import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true, setuDisclaimers: true } }));

const mockGetFamilyByFid = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-family-by-fid', () => ({
  getFamilyByFid: mockGetFamilyByFid,
}));

// Slice 2: the dashboard route computes the additive `disclaimersPending` gate
// signal from this helper (manager + flag on + not-yet-accepted). Default the
// mock to an UNACCEPTED state so a manager reads `disclaimersPending: true`.
const mockGetDisclaimerState = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/disclaimers/acceptance', () => ({
  getDisclaimerStateForFamily: mockGetDisclaimerState,
}));

// portalFirestore() is only handed to the (mocked) disclaimers helper — stub it
// so the route never touches a real Firestore client in unit tests.
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({})),
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
    // Active BV enrollment with no engagement yet → 'registered' (issue #23).
    bvState: 'registered',
    kidsEnrolled: 2,
    enrollPeriodLabel: '2025-26',
    suggestedAmount: 500,
    givenForPeriod: 200,
    donation: { complete: false, pct: 40, tone: 'warn', showGive: true, showProgress: true, heading: 'Donation pending' },
    isLegacyPeriod: false,
    legacyPaid: false,
    otherProgramCards: [{ eid: 'e2', programKey: 'tabla', label: 'Tabla', termLabel: '2025-26', status: 'active', showAttendance: false, showDonation: true }],
    // Extensibility seam (Slice 1): the donation lives in the balaVihar section,
    // NOT as an action item, so actionItems is ALWAYS empty today. Slice 2 will
    // populate it (e.g. a disclaimers item).
    actionItems: [],
  },
  upcoming: [{ entryId: 'x', date: '2026-01-11', kind: 'class', classType: 'regular', specialEvents: null }],
  seva: { currentSevaYear: '2025-26', hoursPerYear: 20, hoursEarned: 4 },
  prasad: { paid: 'p-1', pid: 'pid', date: '2026-03-01', youngestName: 'Anya', birthMonth: 3, reason: "Anya's birthday month", status: 'proposed', movable: true },
  // Per-child BV rows (Task 5) — N=2 children, each with level + teachers + attendance.
  bvChildren: [
    { mid: 'CMT-AB12CD34-02', firstName: 'Anya', levelName: 'Bala Vihar 3', teacherNames: ['Meera Iyer'], attendance: { present: 6, total: 8 } },
    { mid: 'CMT-AB12CD34-03', firstName: 'Kiran', levelName: 'Bala Vihar 1', teacherNames: ['Ravi Nair', 'Sita Rao'], attendance: { present: 4, total: 8 } },
  ],
  familyCounts: { children: 2, adults: 2 },
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
  // Default: current disclaimers NOT accepted by this family.
  mockGetDisclaimerState.mockResolvedValue({ accepted: false, version: 1, schoolYear: '2026-27', sections: [] });
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
    // Three-state engagement flag (issue #23) rides alongside isEnrolled.
    expect(body.balaVihar.isEnrolled).toBe(true);
    expect(body.balaVihar.bvState).toBe('registered');
    // Attendance is no longer a family-level / dashboard concept (#3).
    expect(body.balaVihar.attendance).toBeUndefined();
    // Family header counts (Task 5) — child/adult split for the Family block.
    expect(body.family.counts).toEqual({ children: 2, adults: 2 });
    // Per-child BV rows (Task 5) — one per enrolled child, plain-serializable.
    expect(body.balaVihar.children).toHaveLength(2);
    expect(body.balaVihar.children[0]).toMatchObject({
      mid: 'CMT-AB12CD34-02',
      firstName: 'Anya',
      levelName: 'Bala Vihar 3',
      teacherNames: ['Meera Iyer'],
      attendance: { present: 6, total: 8 },
    });
    expect(body.balaVihar.children[1].teacherNames).toEqual(['Ravi Nair', 'Sita Rao']);
    // actionItems is the forward-compatible seam — ALWAYS empty in Slice 1 (the
    // BV donation is surfaced via balaVihar donation fields, NOT as an action
    // item; owner decision 2026-07-03 / df319d2). Slice 2 populates it.
    expect(body.actionItems).toEqual([]);
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

  // Issue #23: the three-state engagement flag is surfaced straight from the
  // model (the loader derives it from attendance + donations). The route just
  // passes model.bvState through, so each state is exercised by varying the
  // mocked loadFamilyDashboard model.
  describe('balaVihar.bvState (issue #23 engagement states)', () => {
    it("emits 'registered' for an active BV enrollment with no engagement", async () => {
      mockLoad.mockResolvedValue({
        ...dashboardData,
        model: { ...dashboardData.model, isEnrolled: true, bvState: 'registered' },
      });
      const res = await GET(makeRequest({ role: 'family-manager', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-01' }));
      const body = await res.json();
      expect(body.balaVihar.bvState).toBe('registered');
      // isEnrolled keeps its doc-exists semantics — NOT re-derived from bvState.
      expect(body.balaVihar.isEnrolled).toBe(true);
    });

    it("emits 'enrolled' once the family has engaged (attendance or completed donation)", async () => {
      mockLoad.mockResolvedValue({
        ...dashboardData,
        model: { ...dashboardData.model, isEnrolled: true, bvState: 'enrolled' },
      });
      const res = await GET(makeRequest({ role: 'family-manager', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-01' }));
      const body = await res.json();
      expect(body.balaVihar.bvState).toBe('enrolled');
      expect(body.balaVihar.isEnrolled).toBe(true);
    });

    it("emits 'none' when there is no active BV enrollment", async () => {
      mockLoad.mockResolvedValue({
        ...dashboardData,
        model: { ...dashboardData.model, isEnrolled: false, bvState: 'none' },
      });
      const res = await GET(makeRequest({ role: 'family-manager', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-01' }));
      const body = await res.json();
      expect(body.balaVihar.bvState).toBe('none');
      expect(body.balaVihar.isEnrolled).toBe(false);
    });
  });

  // Slice 2: additive top-level `disclaimersPending` gate signal for mobile.
  // Only meaningful for a manager (per-family acceptance) and only when the
  // feature flag is on; computed fail-soft (any read error ⇒ false).
  describe('disclaimersPending (Slice 2 gate signal)', () => {
    it('includes disclaimersPending (true for an unaccepted manager)', async () => {
      mockGetDisclaimerState.mockResolvedValue({ accepted: false, version: 1, schoolYear: '2026-27', sections: [] });
      const res = await GET(makeRequest({ role: 'family-manager', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-01' }));
      const body = await res.json();
      expect(body).toHaveProperty('disclaimersPending', true);
    });

    it('is false for a family-member (per-family acceptance is a manager concern)', async () => {
      const res = await GET(makeRequest({ role: 'family-member', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-02' }));
      const body = await res.json();
      expect(body.disclaimersPending).toBe(false);
      // The gate helper is never consulted for a non-manager.
      expect(mockGetDisclaimerState).not.toHaveBeenCalled();
    });

    it('is false once the family has accepted the current disclaimers', async () => {
      mockGetDisclaimerState.mockResolvedValue({ accepted: true, version: 1, schoolYear: '2026-27', sections: [] });
      const res = await GET(makeRequest({ role: 'family-manager', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-01' }));
      const body = await res.json();
      expect(body.disclaimersPending).toBe(false);
    });

    it('fails soft to false when the disclaimers read throws', async () => {
      mockGetDisclaimerState.mockRejectedValue(new Error('firestore blip'));
      const res = await GET(makeRequest({ role: 'family-manager', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-01' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.disclaimersPending).toBe(false);
    });
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { GET: flaggedGET } = await import('../route');
    const res = await flaggedGET(makeRequest({ role: 'family-manager', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-01' }));
    expect(res.status).toBe(404);
  });
});
