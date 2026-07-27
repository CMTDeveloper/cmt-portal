import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `buildAttendanceDetailIndex` — the parent contact + payment verdict the teacher
 * attendance row needs (spec §4.4), for ONE level's families.
 *
 * Two properties are load-bearing and both are asserted here rather than
 * described in a comment:
 *
 *  1. **No per-family fan-out.** The fake DB counts
 *     `families/{fid}/members.get()` calls; contacts come from ONE batched
 *     `getAll` of the manager member docs, addressed by the mids the family docs
 *     already carry. `roster-fetch.test.ts:126` guards the same property for
 *     `deriveRoster`; this is the same rule for the same request.
 *  2. **The payment verdict is `classifyRosterPayment`'s, not a fifth hand-rolled
 *     copy of the override → live offering → snapshot chain.** That chain was
 *     deleted from four callers on 2026-07-26 precisely because each copy had
 *     drifted; the tests below pin the two verdicts a boolean cannot express
 *     (`not-applicable`, `unknown`) so nobody re-flattens them later.
 */

// The module under test passes its `db` in, but its import chain reaches
// get-enrollments → the admin SDK. Mock it so importing never initialises
// Firebase (same guard build-csv-rows.test.ts uses).
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: vi.fn() }));

type Row = Record<string, unknown> & { id: string; __fid?: string };
const { fs } = vi.hoisted(() => ({
  fs: {
    data: {} as Record<string, Row[]>,
    perFamilyMemberSubGets: 0,
    getAllCalls: 0,
    donationQueries: [] as unknown[][],
  },
}));

function snap(id: string, data: Row | undefined, parentFid?: string) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
    ref: { parent: { parent: { id: parentFid ?? id } } },
  };
}

const db = {
  collection(name: string) {
    return {
      doc(id: string) {
        return {
          id,
          get: async () => snap(id, (fs.data[name] ?? []).find((r) => r.id === id)),
          collection(sub: string) {
            return {
              // The fan-out this module must never do.
              get: async () => {
                if (sub === 'members') fs.perFamilyMemberSubGets++;
                return { docs: (fs.data[sub] ?? []).filter((r) => r.__fid === id).map((r) => snap(r.id, r, id)) };
              },
              doc: (subId: string) => ({
                id: subId,
                get: async () =>
                  snap(subId, (fs.data[sub] ?? []).find((r) => r.__fid === id && r.id === subId), id),
              }),
            };
          },
        };
      },
      where(field: string, op: string, value: unknown) {
        if (name === 'donations') fs.donationQueries.push(value as unknown[]);
        return {
          get: async () => ({
            docs: (fs.data[name] ?? [])
              .filter((r) => (op === 'in' ? (value as unknown[]).includes(r[field]) : r[field] === value))
              .map((r) => snap(r.id, r, r.__fid)),
          }),
        };
      },
    };
  },
  async getAll(...refs: Array<{ get: () => Promise<unknown> }>) {
    fs.getAllCalls++;
    return Promise.all(refs.map((r) => r.get()));
  },
} as unknown as FirebaseFirestore.Firestore;

import { buildAttendanceDetailIndex, type AttendanceEnrollmentMeta } from '../attendance-detail';

const ENROLLED_AT = new Date('2026-09-01T12:00:00Z');

/** One family's enrollment meta, as `deriveRoster` now hands it over. */
function meta(over: Partial<AttendanceEnrollmentMeta> = {}): AttendanceEnrollmentMeta {
  return {
    oid: 'bv-brampton-2026-27',
    enrolledAt: ENROLLED_AT,
    suggestedAmountOverride: null,
    suggestedAmountSnapshot: 0,
    ...over,
  };
}

beforeEach(() => {
  fs.perFamilyMemberSubGets = 0;
  fs.getAllCalls = 0;
  fs.donationQueries = [];
  fs.data = {
    families: [
      { id: 'CMT-A', managers: ['CMT-A-01'] },
      { id: 'CMT-B', managers: ['CMT-B-01'] },
    ],
    members: [
      { id: 'CMT-A-01', __fid: 'CMT-A', mid: 'CMT-A-01', firstName: 'Asha', lastName: 'Apple', type: 'Adult', email: 'asha@example.com', phone: '416-555-0100' },
      { id: 'CMT-A-02', __fid: 'CMT-A', mid: 'CMT-A-02', firstName: 'Anil', lastName: 'Apple', type: 'Child' },
      { id: 'CMT-B-01', __fid: 'CMT-B', mid: 'CMT-B-01', firstName: 'Bela', lastName: 'Berry', type: 'Adult', email: 'bela@example.com', phone: '416-555-0200' },
    ],
    offerings: [
      {
        id: 'bv-brampton-2026-27',
        oid: 'bv-brampton-2026-27',
        // Two tiers: the second is the one an ENROLLED_AT of 2026-09-01 selects.
        pricingTiers: [
          { effectiveFrom: '2026-06-01', amountCAD: 100 },
          { effectiveFrom: '2026-08-15', amountCAD: 200 },
        ],
      },
    ],
    donations: [
      { id: 'd1', fid: 'CMT-A', amountCAD: 200, status: 'completed' },
      { id: 'd2', fid: 'CMT-B', amountCAD: 50, status: 'completed' },
    ],
  };
});

const MGRS = new Map([
  ['CMT-A', 'CMT-A-01'],
  ['CMT-B', 'CMT-B-01'],
]);

describe('buildAttendanceDetailIndex', () => {
  it('resolves the parent contact for every family on the level', async () => {
    const idx = await buildAttendanceDetailIndex(db, ['CMT-A', 'CMT-B'], new Map([['CMT-A', meta()], ['CMT-B', meta()]]), MGRS);
    expect(idx.get('CMT-A')).toMatchObject({
      parentName: 'Asha Apple',
      parentEmail: 'asha@example.com',
      parentPhone: '416-555-0100',
    });
    // N=2: the second family resolves to its OWN parent, not the first's.
    expect(idx.get('CMT-B')).toMatchObject({ parentName: 'Bela Berry', parentEmail: 'bela@example.com' });
  });

  it('does ZERO per-family member subcollection reads', async () => {
    await buildAttendanceDetailIndex(db, ['CMT-A', 'CMT-B'], new Map([['CMT-A', meta()], ['CMT-B', meta()]]), MGRS);
    expect(fs.perFamilyMemberSubGets).toBe(0);
    expect(fs.getAllCalls).toBeGreaterThan(0);
  });

  it('uses the LIVE offering amount, not the enrollment snapshot', async () => {
    // snapshot 100, live tier at ENROLLED_AT = 200, donated 200. Reading the
    // snapshot would call this family paid at 100 and disagree with the welcome
    // roster's chip for the same family after any pricing-tier change.
    const idx = await buildAttendanceDetailIndex(
      db,
      ['CMT-A'],
      new Map([['CMT-A', meta({ suggestedAmountSnapshot: 100 })]]),
      MGRS,
    );
    expect(idx.get('CMT-A')!.payment).toBe('paid'); // 200 >= 200
  });

  it('reports outstanding when completed donations fall short of the live amount', async () => {
    const idx = await buildAttendanceDetailIndex(db, ['CMT-B'], new Map([['CMT-B', meta()]]), MGRS);
    expect(idx.get('CMT-B')!.payment).toBe('outstanding'); // 50 < 200
  });

  it('ignores non-completed donations', async () => {
    fs.data.donations = [
      { id: 'd1', fid: 'CMT-A', amountCAD: 500, status: 'pending' },
      { id: 'd2', fid: 'CMT-A', amountCAD: 10, status: 'completed' },
    ];
    const idx = await buildAttendanceDetailIndex(db, ['CMT-A'], new Map([['CMT-A', meta()]]), MGRS);
    expect(idx.get('CMT-A')!.payment).toBe('outstanding'); // only the 10 counts
  });

  it('SUMS several completed donations for one family', async () => {
    // N=2. A single-donation fixture cannot tell summing from overwriting, and
    // families pay in instalments - two $100 payments against a $200 fee is the
    // ordinary case, not an edge case.
    fs.data.donations = [
      { id: 'd1', fid: 'CMT-B', amountCAD: 100, status: 'completed' },
      { id: 'd2', fid: 'CMT-B', amountCAD: 100, status: 'completed' },
    ];
    const idx = await buildAttendanceDetailIndex(db, ['CMT-B'], new Map([['CMT-B', meta()]]), MGRS);
    expect(idx.get('CMT-B')!.payment).toBe('paid'); // 100 + 100 >= 200
  });

  it('falls back to a POSITIVE snapshot when the offering doc is gone', async () => {
    // The only path on which the snapshot is read at all: with an offering
    // present the live amount always wins, so without this the snapshot could be
    // hardcoded to 0 and every other test would still pass.
    fs.data.offerings = [];
    const idx = await buildAttendanceDetailIndex(
      db,
      ['CMT-A'],
      new Map([['CMT-A', meta({ oid: 'vanished-oid', suggestedAmountSnapshot: 150 })]]),
      MGRS,
    );
    // CMT-A donated 200 against a snapshot of 150 - priced, and settled.
    expect(idx.get('CMT-A')!.payment).toBe('paid');
  });

  it('prefers suggestedAmountOverride over both the live amount and the snapshot', async () => {
    const idx = await buildAttendanceDetailIndex(
      db,
      ['CMT-B'],
      new Map([['CMT-B', meta({ suggestedAmountOverride: 50, suggestedAmountSnapshot: 999 })]]),
      MGRS,
    );
    expect(idx.get('CMT-B')!.payment).toBe('paid'); // 50 donated >= 50 owed
  });

  it('reads a free program as not-applicable, never as outstanding', async () => {
    // The verdict a boolean cannot carry. `paid` is reserved for money that
    // actually arrived, so a family who owes nothing must not be labelled either
    // paid OR outstanding.
    fs.data.offerings = [{ id: 'free-oid', oid: 'free-oid', pricingTiers: [] }];
    const idx = await buildAttendanceDetailIndex(
      db,
      ['CMT-B'],
      new Map([['CMT-B', meta({ oid: 'free-oid' })]]),
      MGRS,
    );
    expect(idx.get('CMT-B')!.payment).toBe('not-applicable');
  });

  it('reads a missing offering doc as unknown, never as not-applicable', async () => {
    // Nothing ever priced this enrollment, so "no fee applies" would be a lie.
    fs.data.offerings = [];
    const idx = await buildAttendanceDetailIndex(
      db,
      ['CMT-B'],
      new Map([['CMT-B', meta({ oid: 'vanished-oid' })]]),
      MGRS,
    );
    expect(idx.get('CMT-B')!.payment).toBe('unknown');
  });

  it('reads an off-portal (teacher-managed) offering as unknown', async () => {
    // Cash collected by the teacher settles somewhere this function cannot see.
    fs.data.offerings = [
      { id: 'cash-oid', oid: 'cash-oid', pricingTiers: [], paymentSource: 'teacher-managed' },
    ];
    const idx = await buildAttendanceDetailIndex(
      db,
      ['CMT-B'],
      new Map([['CMT-B', meta({ oid: 'cash-oid' })]]),
      MGRS,
    );
    expect(idx.get('CMT-B')!.payment).toBe('unknown');
  });

  it('reads donations in chunks of 30 fids (the Firestore `in` cap is hard)', async () => {
    const fids = Array.from({ length: 65 }, (_, i) => `CMT-${i}`);
    const metas = new Map(fids.map((f) => [f, meta()] as const));
    await buildAttendanceDetailIndex(db, fids, metas, new Map());
    expect(fs.donationQueries).toHaveLength(3); // 30 + 30 + 5
    expect(fs.donationQueries.map((c) => c.length)).toEqual([30, 30, 5]);
    // Every fid is covered exactly once - a chunker that dropped the tail would
    // still produce 3 queries.
    expect(fs.donationQueries.flat().sort()).toEqual([...fids].sort());
  });

  it('returns a null parent when the family has no manager member doc', async () => {
    const idx = await buildAttendanceDetailIndex(
      db,
      ['CMT-A'],
      new Map([['CMT-A', meta()]]),
      new Map([['CMT-A', null]]),
    );
    expect(idx.get('CMT-A')).toMatchObject({ parentName: null, parentEmail: null, parentPhone: null });
    // ...but the payment verdict still resolves - a missing parent is not a
    // reason to withhold what we do know.
    expect(idx.get('CMT-A')!.payment).toBe('paid');
  });

  it('reads unknown for an unparseable enrolledAt instead of throwing', async () => {
    // `resolveSuggestedAmount` formats the date with Intl.DateTimeFormat, which
    // throws RangeError on an Invalid Date - one malformed enrollment doc would
    // take down the whole attendance page, not just this family's chip.
    const idx = await buildAttendanceDetailIndex(
      db,
      ['CMT-A'],
      new Map([['CMT-A', meta({ enrolledAt: new Date('not-a-date') })]]),
      MGRS,
    );
    expect(idx.get('CMT-A')!.payment).toBe('unknown');
    // The contact still resolves - one bad field must not withhold the rest.
    expect(idx.get('CMT-A')!.parentName).toBe('Asha Apple');
  });

  it('reads unknown for a family with no active enrollment on this level', async () => {
    const idx = await buildAttendanceDetailIndex(db, ['CMT-A'], new Map(), MGRS);
    expect(idx.get('CMT-A')!.payment).toBe('unknown');
  });

  it('throws if handed a program-scoped fid set instead of a level-scoped one', async () => {
    const many = Array.from({ length: 151 }, (_, i) => `CMT-${i}`);
    await expect(buildAttendanceDetailIndex(db, many, new Map(), new Map())).rejects.toThrow(/LEVEL-scoped/);
  });

  it('returns an empty index for no families, without querying', async () => {
    const idx = await buildAttendanceDetailIndex(db, [], new Map(), new Map());
    expect(idx.size).toBe(0);
    expect(fs.donationQueries).toHaveLength(0);
    expect(fs.getAllCalls).toBe(0);
  });
});
