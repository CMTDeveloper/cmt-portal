import { describe, it, expect, vi } from 'vitest';
import { deriveConfirmedFidsForLevel, type LevelEnrollment } from '../roster-confirmation';

vi.mock('@/features/setu/donations/legacy-payment', () => ({
  getLegacyPaymentStatus: vi.fn(async (lf: string) => (lf === 'legacy-PAID' ? 'paid' : 'partial')),
}));

// Minimal fake Firestore. Donations are now read in BULK via one
// collectionGroup('donations').get() (status filtered in memory), NOT a
// per-family subcollection fan-out — so `collection('families')` is never
// touched and throws if it is (guards against a fan-out regression).
const counters = { collectionGroupDonations: 0 };

type FakeDonation = { status: string; eid: string; amountCAD?: number };

/**
 * `donations` is a TOP-LEVEL collection: create-donation.ts:28 writes
 * `db.collection('donations').doc()` with an `fid` FIELD, so every real doc has
 * `ref.parent.parent === null`. A collectionGroup('donations') query still
 * matches it (collection-group ids include root-level collections).
 *
 * This fixture used to emit the exact inverse (a populated parent path and no
 * `fid` field), which is why the suite stayed green while the teacher roster
 * never confirmed a single donation in production. 'top-level' is the default
 * because it is the only shape that exists in any environment;
 * 'legacy-subcollection' exists solely to pin the defensive parent-path
 * fallback the three sibling readers also keep.
 */
function donationDocs(
  byFid: Record<string, FakeDonation[]>,
  shape: 'top-level' | 'legacy-subcollection',
) {
  return Object.entries(byFid).flatMap(([fid, docs]) =>
    docs.map((d) =>
      shape === 'top-level'
        ? { data: () => ({ ...d, fid }), ref: { parent: { parent: null } } }
        : { data: () => d, ref: { parent: { parent: { id: fid } } } },
    ),
  );
}

function fakeDb(opts: {
  attendance: Array<{ mid: string; status: string }>;
  paymentSource?: string;
  donationsByFid?: Record<string, FakeDonation[]>;
  donationShape?: 'top-level' | 'legacy-subcollection';
}) {
  const allDonations = donationDocs(opts.donationsByFid ?? {}, opts.donationShape ?? 'top-level');
  return {
    collection(name: string) {
      if (name === 'attendanceEvents') {
        return { where: () => ({ get: async () => ({ docs: opts.attendance.map((d) => ({ data: () => d })) }) }) };
      }
      if (name === 'offerings') {
        return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ paymentSource: opts.paymentSource ?? 'portal' }) }) }) };
      }
      throw new Error(`unexpected per-family read via collection('${name}') — donations must be bulk`);
    },
    collectionGroup(name: string) {
      if (name !== 'donations') throw new Error(`unexpected collectionGroup ${name}`);
      counters.collectionGroupDonations++;
      return { get: async () => ({ docs: allDonations }) };
    },
  } as unknown as FirebaseFirestore.Firestore;
}

const base = (o: Partial<LevelEnrollment>): LevelEnrollment => ({
  fid: 'F', eid: 'F-o', oid: 'o', enrolledVia: 'promotion', enrolledMids: ['F-01'], legacyFid: null, ...o,
});

describe('deriveConfirmedFidsForLevel', () => {
  it('confirms family-initiated and first-attendance without any reads', async () => {
    const db = fakeDb({ attendance: [] });
    const set = await deriveConfirmedFidsForLevel(db, 'o', [
      base({ fid: 'A', eid: 'A-o', enrolledMids: ['A-01'], enrolledVia: 'family-initiated' }),
      base({ fid: 'B', eid: 'B-o', enrolledMids: ['B-01'], enrolledVia: 'first-attendance' }),
    ]);
    expect(set).toEqual(new Set(['A', 'B']));
  });

  it('confirms a promotion enrollment once any enrolled mid has a present/late mark', async () => {
    const db = fakeDb({ attendance: [{ mid: 'C-02', status: 'present' }] });
    const set = await deriveConfirmedFidsForLevel(db, 'o', [
      base({ fid: 'C', eid: 'C-o', enrolledMids: ['C-01', 'C-02'] }), // C-02 attended
      base({ fid: 'D', eid: 'D-o', enrolledMids: ['D-01'] }),        // no signal
    ]);
    expect(set).toEqual(new Set(['C']));
  });

  it('confirms via a completed donation tied to the eid, and via legacy-paid', async () => {
    counters.collectionGroupDonations = 0;
    const db = fakeDb({
      attendance: [],
      paymentSource: 'legacy',
      donationsByFid: { E: [{ status: 'completed', eid: 'E-o' }] },
    });
    const set = await deriveConfirmedFidsForLevel(db, 'o', [
      base({ fid: 'E', eid: 'E-o' }),                                   // donation
      base({ fid: 'G', eid: 'G-o', legacyFid: 'legacy-PAID' }),         // legacy-paid
      base({ fid: 'H', eid: 'H-o', legacyFid: 'legacy-partial' }),      // nothing → not confirmed
    ]);
    expect(set).toEqual(new Set(['E', 'G']));
    // ONE bulk donations read for all 3 inconclusive families — not a per-family fan-out.
    expect(counters.collectionGroupDonations).toBe(1);
  });

  it('confirms a family from a TOP-LEVEL donation doc (fid in data, no parent doc)', async () => {
    // The real production shape. The `eid` is load-bearing: confirmation runs
    // through isEnrollmentConfirmed, whose donation clause is
    //   donations.some((d) => d.status === 'completed' && d.eid === enrollment.eid)
    // (app/family/_helpers/enrollment-confirmation.ts:38). A donation grouped
    // under the right fid but carrying the wrong eid is discarded, so this test
    // would still fail after the fid fix and tell you nothing.
    const db = fakeDb({
      attendance: [],
      donationsByFid: {
        'CMT-FAM-01': [{ status: 'completed', eid: 'CMT-FAM-01-o', amountCAD: 200 }],
      },
    });
    const confirmed = await deriveConfirmedFidsForLevel(db, 'bala-vihar-2026-27', [
      base({ fid: 'CMT-FAM-01', eid: 'CMT-FAM-01-o', enrolledMids: ['CMT-FAM-01-01'] }),
    ]);
    expect(confirmed.has('CMT-FAM-01')).toBe(true);
  });

  it('still resolves an fid from the parent path when the doc carries no fid field', async () => {
    // Pins the defensive fallback. No such doc exists in any environment today;
    // the three sibling readers (enrollment-report.ts:178, report-dataset.ts:111,
    // build-csv-rows.ts:78) all keep it, so this one does too.
    const db = fakeDb({
      attendance: [],
      donationShape: 'legacy-subcollection',
      donationsByFid: { 'CMT-FAM-02': [{ status: 'completed', eid: 'CMT-FAM-02-o' }] },
    });
    const confirmed = await deriveConfirmedFidsForLevel(db, 'bala-vihar-2026-27', [
      base({ fid: 'CMT-FAM-02', eid: 'CMT-FAM-02-o', enrolledMids: ['CMT-FAM-02-01'] }),
    ]);
    expect(confirmed.has('CMT-FAM-02')).toBe(true);
  });
});
