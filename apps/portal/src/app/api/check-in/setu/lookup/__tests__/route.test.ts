import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const flagsMock = vi.hoisted(() => ({ checkInKiosk: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

const mocks = vi.hoisted(() => ({
  resolveKioskFamily: vi.fn(),
  getFamilyByFid: vi.fn(),
  getOpenOfferingsForFamily: vi.fn(),
  fetchEnabledLevelsForPid: vi.fn(),
}));
vi.mock('@/features/setu/check-in/resolve-kiosk-family', () => ({
  resolveKioskFamily: mocks.resolveKioskFamily,
  // The route calls resolveKioskFamilyOrMigrate (resolve + lazy migrate-on-miss);
  // point it at the same mock so these route tests exercise the route's behavior
  // given a resolver result. The migrate-on-miss logic itself is unit-tested in
  // features/setu/check-in/__tests__/resolve-kiosk-family.test.ts.
  resolveKioskFamilyOrMigrate: mocks.resolveKioskFamily,
}));
vi.mock('@/features/setu/members/get-family-by-fid', () => ({
  getFamilyByFid: mocks.getFamilyByFid,
}));
vi.mock('@/features/setu/enrollment/get-open-offerings', () => ({
  getOpenOfferingsForFamily: mocks.getOpenOfferingsForFamily,
}));
// Mock ONLY the Firestore-backed level fetch; keep the pure matchChildLevel real
// so the route's real grade→level matching is exercised end to end.
vi.mock('@/features/setu/enrollment/derive-child-level', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/setu/enrollment/derive-child-level')>();
  return { ...actual, fetchEnabledLevelsForPid: mocks.fetchEnabledLevelsForPid };
});

import * as appHandler from '../route';

const resolvedFamily = {
  fid: 'CMT-A',
  publicFid: '1075',
  legacyFid: '477',
  location: 'Brampton' as const,
  name: 'Rana family',
  matchedOn: 'publicFid' as const,
};

// Realistic multi-instance fixture: 2 adults (excluded) + 2 children (students).
const familyAndMembers = {
  family: {
    fid: 'CMT-A',
    publicFid: '1075',
    legacyFid: '477',
    name: 'Rana family',
    location: 'Brampton',
    createdAt: new Date('2024-01-01'),
    managers: ['CMT-A-01'],
    searchKeys: [],
  },
  members: [
    { mid: 'CMT-A-01', firstName: 'Raj', lastName: 'Rana', type: 'Adult', manager: true, schoolGrade: null },
    { mid: 'CMT-A-02', firstName: 'Priya', lastName: 'Rana', type: 'Adult', manager: false, schoolGrade: null },
    { mid: 'CMT-A-03', firstName: 'Aarav', lastName: 'Rana', type: 'Child', manager: false, schoolGrade: 'Grade 3' },
    { mid: 'CMT-A-04', firstName: 'Isha', lastName: 'Rana', type: 'Child', manager: false, schoolGrade: 'Grade 1' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.checkInKiosk = true;
  mocks.getFamilyByFid.mockResolvedValue(familyAndMembers);
  // Default: no open Bala Vihar offering (off-season) → children fall back to a
  // friendly grade label. Individual tests override to exercise level derivation.
  mocks.getOpenOfferingsForFamily.mockResolvedValue([]);
  mocks.fetchEnabledLevelsForPid.mockResolvedValue([]);
});

describe('GET /api/check-in/setu/lookup', () => {
  it('resolves a publicFid and returns the WHOLE family (adults + children) as members', async () => {
    mocks.resolveKioskFamily.mockResolvedValue(resolvedFamily);
    await testApiHandler({
      appHandler,
      url: '/api/check-in/setu/lookup?id=1075',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();

        // Family-level fields the kiosk panel renders.
        expect(body.name).toBe('Rana family');
        // fid must be a value Task-5's resolveKioskFamily can re-resolve for submit
        // (publicFid preferred), NOT the CMT- doc id which it cannot look up.
        expect(body.fid).toBe('1075');

        // The kiosk checks in the whole family: all 4 members appear so a sevak
        // can check who actually came. Adults are flagged and carry no level.
        expect(body.students).toHaveLength(4);
        const byMid = Object.fromEntries(
          body.students.map((s: { sid: string }) => [s.sid, s]),
        );
        expect(byMid['CMT-A-01']).toMatchObject({
          firstName: 'Raj',
          isAdult: true,
          level: '',
        });
        expect(byMid['CMT-A-02']).toMatchObject({ firstName: 'Priya', isAdult: true });
        // Off-season (no open offering): level falls back to the friendly grade,
        // and the grade is carried for verification.
        expect(byMid['CMT-A-03']).toMatchObject({
          firstName: 'Aarav',
          isAdult: false,
          level: 'Grade 3',
          grade: 'Grade 3',
        });
        expect(byMid['CMT-A-04']).toMatchObject({ firstName: 'Isha', isAdult: false });
      },
    });
    expect(mocks.resolveKioskFamily).toHaveBeenCalledWith('1075');
    expect(mocks.getFamilyByFid).toHaveBeenCalledWith('CMT-A');
  });

  it('derives each child\'s Bala Vihar level from the open offering, keeping the grade', async () => {
    mocks.resolveKioskFamily.mockResolvedValue(resolvedFamily);
    mocks.getOpenOfferingsForFamily.mockResolvedValue([{ oid: 'oid-1' }]);
    mocks.fetchEnabledLevelsForPid.mockResolvedValue([
      { levelId: 'L3', levelName: 'Level 3', levelKind: 'level', gradeBand: ['3'] },
      { levelId: 'L1', levelName: 'Level 1', levelKind: 'level', gradeBand: ['1'] },
    ]);
    await testApiHandler({
      appHandler,
      url: '/api/check-in/setu/lookup?id=1075',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        const byMid = Object.fromEntries(
          body.students.map((s: { sid: string }) => [s.sid, s]),
        );
        // Child grade 'Grade 3' → normalizeGrade '3' → matches gradeBand ['3'].
        expect(byMid['CMT-A-03']).toMatchObject({ level: 'Level 3', grade: 'Grade 3' });
        expect(byMid['CMT-A-04']).toMatchObject({ level: 'Level 1', grade: 'Grade 1' });
        // Adults carry no level and no grade.
        expect(byMid['CMT-A-01']).toMatchObject({ isAdult: true, level: '' });
        expect(byMid['CMT-A-01'].grade).toBeUndefined();
      },
    });
    // Uses the family's location to find the current Bala Vihar offering, then
    // that offering's enabled levels.
    expect(mocks.getOpenOfferingsForFamily).toHaveBeenCalledWith('bala-vihar', 'Brampton');
    expect(mocks.fetchEnabledLevelsForPid).toHaveBeenCalledWith('oid-1');
  });

  it('returns 404 family-not-found for an unknown id', async () => {
    mocks.resolveKioskFamily.mockResolvedValue(null);
    await testApiHandler({
      appHandler,
      url: '/api/check-in/setu/lookup?id=9999',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('family-not-found');
      },
    });
    expect(mocks.getFamilyByFid).not.toHaveBeenCalled();
  });

  it('returns 400 bad-request for a blank id', async () => {
    await testApiHandler({
      appHandler,
      url: '/api/check-in/setu/lookup?id=%20%20',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('bad-request');
      },
    });
    expect(mocks.resolveKioskFamily).not.toHaveBeenCalled();
  });

  it('returns 400 bad-request when id is missing entirely', async () => {
    await testApiHandler({
      appHandler,
      url: '/api/check-in/setu/lookup',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('bad-request');
      },
    });
  });

  it('returns 404 not-found when the kiosk flag is off', async () => {
    flagsMock.checkInKiosk = false;
    mocks.resolveKioskFamily.mockResolvedValue(resolvedFamily);
    await testApiHandler({
      appHandler,
      url: '/api/check-in/setu/lookup?id=1075',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('not-found');
      },
    });
    expect(mocks.resolveKioskFamily).not.toHaveBeenCalled();
  });
});
