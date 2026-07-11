import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const flagsMock = vi.hoisted(() => ({ checkInKiosk: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

const mocks = vi.hoisted(() => ({
  resolveKioskFamily: vi.fn(),
  getFamilyByFid: vi.fn(),
}));
vi.mock('@/features/setu/check-in/resolve-kiosk-family', () => ({
  resolveKioskFamily: mocks.resolveKioskFamily,
}));
vi.mock('@/features/setu/members/get-family-by-fid', () => ({
  getFamilyByFid: mocks.getFamilyByFid,
}));

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
});

describe('GET /api/check-in/setu/lookup', () => {
  it('resolves a publicFid and returns the Family with children mapped to students', async () => {
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

        // Only children become students; the two adults are excluded.
        expect(body.students).toHaveLength(2);
        const sids = body.students.map((s: { sid: string }) => s.sid);
        expect(sids).toEqual(['CMT-A-03', 'CMT-A-04']);

        const first = body.students[0];
        expect(first).toMatchObject({
          sid: 'CMT-A-03',
          firstName: 'Aarav',
          lastName: 'Rana',
          level: 'Grade 3',
        });
      },
    });
    expect(mocks.resolveKioskFamily).toHaveBeenCalledWith('1075');
    expect(mocks.getFamilyByFid).toHaveBeenCalledWith('CMT-A');
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
