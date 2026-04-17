import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

// ── hoisted mocks ────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const fakeGetAll = vi.fn();
  const fakeCollection = vi.fn();
  const fakeDoc = vi.fn();

  // portalFirestore() returns an object with collection() and getAll()
  const fakeFirestore = {
    collection: fakeCollection,
    getAll: fakeGetAll,
  };

  // collection('family-check-ins').doc(fid).collection('checkIns').doc(date)
  const subDocRef = { id: 'ref', get: vi.fn() }; // stub ref
  const subCollection = { doc: vi.fn(() => subDocRef) };
  const familyDoc = { collection: vi.fn(() => subCollection) };
  const topCollection = { doc: vi.fn(() => familyDoc) };

  fakeCollection.mockReturnValue(topCollection);
  fakeDoc.mockReturnValue(familyDoc);

  return { fakeFirestore, fakeGetAll, fakeCollection, topCollection, familyDoc, subCollection, subDocRef };
});

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => mocks.fakeFirestore),
}));

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn(),
}));

vi.mock('@/lib/flags', () => ({
  flags: { checkInTeacher: true },
}));

import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import * as appHandler from '../check-in-report/route';

const mockReadRtdb = readRtdb as ReturnType<typeof vi.fn>;
const mockPortalFirestore = portalFirestore as ReturnType<typeof vi.fn>;

// Roster with two families in Brampton, one in Scarborough
const bramptonRoster = {
  'r1': { sid: '1', fid: '100', fname: 'Alice', lname: 'Smith', grade: 1, center: 'Brampton' },
  'r2': { sid: '2', fid: '100', fname: 'Bob', lname: 'Smith', grade: 99, pfname: 'Carol', plname: 'Smith', center: 'Brampton' },
  'r3': { sid: '3', fid: '200', fname: 'Dave', lname: 'Jones', grade: 1, center: 'Brampton' },
  'r4': { sid: '4', fid: '999', fname: 'Eve', lname: 'Remote', grade: 1, center: 'Scarborough' },
};

function makeSnap(exists: boolean, data?: Record<string, unknown>) {
  return { exists, data: () => data ?? {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore portalFirestore implementation (clearAllMocks wipes it)
  mockPortalFirestore.mockReturnValue(mocks.fakeFirestore);
  // Reset collection chain
  mocks.fakeCollection.mockReturnValue(mocks.topCollection);
  mocks.topCollection.doc.mockReturnValue(mocks.familyDoc);
  mocks.familyDoc.collection.mockReturnValue(mocks.subCollection);
  mocks.subCollection.doc.mockReturnValue(mocks.subDocRef);
  // Default: each ref.get() returns a non-existent snap (all checkIns false)
  mocks.subDocRef.get.mockResolvedValue(makeSnap(false));
});

describe('GET /api/check-in/teacher/check-in-report', () => {
  it('returns 400 when no center param', async () => {
    await testApiHandler({
      appHandler,
      url: '/api/check-in/teacher/check-in-report?month=2026-04',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-portal-uid': 'u1' } });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/center/);
      },
    });
  });

  it('returns empty families when center has no roster entries', async () => {
    mockReadRtdb.mockResolvedValueOnce(bramptonRoster);
    await testApiHandler({
      appHandler,
      url: '/api/check-in/teacher/check-in-report?center=Toronto&month=2026-04',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-portal-uid': 'u1' } });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Object.keys(body.families)).toHaveLength(0);
        expect(body.totalFamilies).toBe(0);
      },
    });
  });

  it('returns correct Sundays for April 2026', async () => {
    mockReadRtdb.mockResolvedValueOnce({});
    await testApiHandler({
      appHandler,
      url: '/api/check-in/teacher/check-in-report?center=Brampton&month=2026-04',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-portal-uid': 'u1' } });
        expect(res.status).toBe(200);
        const body = await res.json();
        // April 2026 Sundays: 5, 12, 19, 26
        expect(body.dates).toEqual(['2026-04-05', '2026-04-12', '2026-04-19', '2026-04-26']);
      },
    });
  });

  it('returns aggregated check-in data with correct booleans', async () => {
    mockReadRtdb.mockResolvedValueOnce(bramptonRoster);
    // Default subDocRef.get() returns non-existent → all checkIns false

    await testApiHandler({
      appHandler,
      url: '/api/check-in/teacher/check-in-report?center=Brampton&month=2026-04',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-portal-uid': 'u1' } });
        const body = await res.json();
        expect(res.status).toBe(200);

        expect(body.totalFamilies).toBe(2);
        expect(body.dates).toEqual(['2026-04-05', '2026-04-12', '2026-04-19', '2026-04-26']);

        const f100 = body.families['100'];
        expect(f100).toBeDefined();
        // parent row override: plname=Smith, pfname=Carol
        expect(f100.name).toBe('Smith, Carol');
        // all snaps are non-existing → all false
        expect(Object.values(f100.checkIns).every((v) => v === false)).toBe(true);
        expect(Object.keys(f100.checkIns)).toEqual(['2026-04-05', '2026-04-12', '2026-04-19', '2026-04-26']);

        const f200 = body.families['200'];
        expect(f200).toBeDefined();
        expect(Object.values(f200.checkIns).every((v) => v === false)).toBe(true);
      },
    });
  });

  it('maps checked-in snapshots to true via array format', async () => {
    // Single family in center Test, January 2026 (Sundays: 4, 11, 18, 25)
    const oneFamily = {
      r1: { sid: '1', fid: '100', fname: 'Alice', lname: 'Smith', grade: 1, center: 'Test' },
    };
    mockReadRtdb.mockResolvedValueOnce(oneFamily);

    // Route calls ref.get() for each (fid, date) pair in order:
    // [100/2026-01-04, 100/2026-01-11, 100/2026-01-18, 100/2026-01-25]
    mocks.subDocRef.get
      .mockResolvedValueOnce(makeSnap(true, { students: [{ sid: '1', isCheckedIn: true }] }))
      .mockResolvedValueOnce(makeSnap(false))
      .mockResolvedValueOnce(makeSnap(true, { students: { '1': true } }))
      .mockResolvedValueOnce(makeSnap(false));

    await testApiHandler({
      appHandler,
      url: '/api/check-in/teacher/check-in-report?center=Test&month=2026-01',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-portal-uid': 'u1' } });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.totalFamilies).toBe(1);
        expect(body.dates).toEqual(['2026-01-04', '2026-01-11', '2026-01-18', '2026-01-25']);
        const f = body.families['100'];
        expect(f.checkIns['2026-01-04']).toBe(true);
        expect(f.checkIns['2026-01-11']).toBe(false);
        expect(f.checkIns['2026-01-18']).toBe(true);
        expect(f.checkIns['2026-01-25']).toBe(false);
      },
    });
  });

  it('includes centers array derived from roster', async () => {
    mockReadRtdb.mockResolvedValueOnce(bramptonRoster);
    // Default subDocRef.get() returns non-existent → fine for this test

    await testApiHandler({
      appHandler,
      url: '/api/check-in/teacher/check-in-report?center=Brampton&month=2026-04',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { 'x-portal-uid': 'u1' } });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.centers).toContain('Brampton');
        expect(body.centers).toContain('Scarborough');
      },
    });
  });
});
