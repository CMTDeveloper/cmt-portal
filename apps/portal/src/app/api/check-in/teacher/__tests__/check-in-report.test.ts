import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

// ── hoisted mocks ────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const subDocGet = vi.fn();
  const subDocRef = { id: 'ref', get: subDocGet };
  const subCollection = { doc: vi.fn(() => subDocRef) };
  const familyDoc = { collection: vi.fn(() => subCollection) };
  const topCollection = { doc: vi.fn(() => familyDoc) };
  const fakeCollection = vi.fn(() => topCollection);
  const fakeFirestore = { collection: fakeCollection };

  return { fakeFirestore, subDocGet, fakeCollection, topCollection, familyDoc, subCollection, subDocRef };
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

const bramptonRoster = {
  r1: { sid: '1', fid: '100', fname: 'Alice', lname: 'Smith', grade: 1, center: 'Brampton' },
  r2: { sid: '2', fid: '100', fname: 'Bob', lname: 'Smith', grade: 99, pfname: 'Carol', plname: 'Smith', center: 'Brampton' },
  r3: { sid: '3', fid: '200', fname: 'Dave', lname: 'Jones', grade: 1, center: 'Brampton' },
  r4: { sid: '4', fid: '999', fname: 'Eve', lname: 'Remote', grade: 1, center: 'Scarborough' },
};

function makeSnap(exists: boolean, data?: Record<string, unknown>) {
  return { exists, data: () => data ?? {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPortalFirestore.mockReturnValue(mocks.fakeFirestore);
  mocks.fakeCollection.mockReturnValue(mocks.topCollection);
  mocks.topCollection.doc.mockReturnValue(mocks.familyDoc);
  mocks.familyDoc.collection.mockReturnValue(mocks.subCollection);
  mocks.subCollection.doc.mockReturnValue(mocks.subDocRef);
  mocks.subDocGet.mockResolvedValue(makeSnap(false));
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
        expect(body.dates).toEqual(['2026-04-05', '2026-04-12', '2026-04-19', '2026-04-26']);
      },
    });
  });

  it('returns aggregated check-in data with correct family names and grid', async () => {
    mockReadRtdb.mockResolvedValueOnce(bramptonRoster);
    // default subDocGet returns makeSnap(false) for all 8 refs
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
        expect(f100.name).toBe('Smith, Carol');
        expect(Object.values(f100.checkIns).every((v) => v === false)).toBe(true);
        expect(Object.keys(f100.checkIns)).toEqual(['2026-04-05', '2026-04-12', '2026-04-19', '2026-04-26']);

        const f200 = body.families['200'];
        expect(f200).toBeDefined();
        expect(Object.values(f200.checkIns).every((v) => v === false)).toBe(true);
      },
    });
  });

  it('maps checked-in snapshots to true via array and object formats', async () => {
    const oneFamily = {
      r1: { sid: '1', fid: '100', fname: 'Alice', lname: 'Smith', grade: 1, center: 'Test' },
    };
    mockReadRtdb.mockResolvedValueOnce(oneFamily);
    // Jan 2026 Sundays: 4,11,18,25 — 4 sequential ref.get() calls
    mocks.subDocGet
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
