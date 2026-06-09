import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
}));

// Seed offerings so the effective amount is deterministic: every offering
// resolves to 100 regardless of date. The bulk builder only uses the resolved
// number, so this keeps the payment math (expected = activeCount * 100) clear.
vi.mock('@cmt/shared-domain', async (orig) => ({
  ...(await orig<typeof import('@cmt/shared-domain')>()),
  resolveSuggestedAmount: vi.fn(() => 100),
}));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { buildRosterCsvRows } from '../build-csv-rows';

const mockFirestore = vi.mocked(portalFirestore);

type Json = Record<string, unknown>;

interface MemberSeed {
  firstName: string;
  lastName: string;
  type: string;
  schoolGrade?: string;
}
interface EnrollmentSeed {
  oid: string;
  programKey: string;
  programLabel: string;
  status: string;
  suggestedAmountOverride?: number;
}
interface DonationSeed {
  status: string;
  amountCAD: number;
}
interface FamilySeed {
  fid: string;
  name: string;
  location: string;
  legacyFid: string | null;
  members: MemberSeed[];
  enrollments: EnrollmentSeed[];
  donations: DonationSeed[];
}

interface DocSnap {
  id: string;
  exists: boolean;
  data: () => Json | undefined;
}

/**
 * Hand-built chainable Firestore fake for the bulk CSV builder.
 *
 * - `collection('families')` (optionally `.where('location','==',x)`) → `.get()`
 *   resolves the family docs.
 * - `collectionGroup('members'|'enrollments'|'donations').get()` flattens every
 *   family's subcollection rows, each carrying `ref.parent.parent.id` (parent fid)
 *   and the `fid` denorm field on enrollment/donation docs.
 * - `collection('offerings').doc(oid)` records a ref; `db.getAll(...refs)`
 *   resolves each ref to an offering snapshot (existence keyed off the oid set).
 */
function makeDb(families: FamilySeed[]) {
  const offeringIds = new Set(
    families.flatMap((f) => f.enrollments.map((e) => e.oid)).filter(Boolean),
  );

  function familyData(f: FamilySeed): Json {
    return { fid: f.fid, name: f.name, location: f.location, legacyFid: f.legacyFid };
  }

  function familiesGet(location?: string) {
    const rows = location ? families.filter((f) => f.location === location) : families;
    return { docs: rows.map((f) => ({ id: f.fid, data: () => familyData(f) })) };
  }

  function memberDocs() {
    return families.flatMap((f) =>
      f.members.map((m, i) => ({
        id: `${f.fid}-m-${i}`,
        ref: { parent: { parent: { id: f.fid } } },
        data: (): Json => ({
          firstName: m.firstName,
          lastName: m.lastName,
          type: m.type,
          ...(m.schoolGrade !== undefined ? { schoolGrade: m.schoolGrade } : {}),
        }),
      })),
    );
  }

  function enrollmentDocs() {
    return families.flatMap((f) =>
      f.enrollments.map((e, i) => ({
        id: `${f.fid}-e-${i}`,
        ref: { parent: { parent: { id: f.fid } } },
        data: (): Json => ({
          fid: f.fid,
          oid: e.oid,
          programKey: e.programKey,
          programLabel: e.programLabel,
          status: e.status,
          enrolledAt: new Date('2025-09-01'),
          ...(e.suggestedAmountOverride !== undefined
            ? { suggestedAmountOverride: e.suggestedAmountOverride }
            : {}),
        }),
      })),
    );
  }

  function donationDocs() {
    return families.flatMap((f) =>
      f.donations.map((dn, i) => ({
        id: `${f.fid}-d-${i}`,
        ref: { parent: { parent: { id: f.fid } } },
        data: (): Json => ({ fid: f.fid, status: dn.status, amountCAD: dn.amountCAD }),
      })),
    );
  }

  const db = {
    collection: vi.fn((col: string) => {
      if (col === 'families') {
        return {
          where: vi.fn((field: string, _op: string, value: unknown) => {
            const loc = field === 'location' ? String(value) : undefined;
            return { get: vi.fn(async () => familiesGet(loc)) };
          }),
          get: vi.fn(async () => familiesGet()),
        };
      }
      if (col === 'offerings') {
        return {
          doc: vi.fn((oid: string) => ({ __kind: 'offeringDoc' as const, oid })),
        };
      }
      throw new Error(`unexpected collection ${col}`);
    }),
    collectionGroup: vi.fn((group: string) => {
      const get = vi.fn(async () => {
        if (group === 'members') return { docs: memberDocs() };
        if (group === 'enrollments') return { docs: enrollmentDocs() };
        if (group === 'donations') return { docs: donationDocs() };
        throw new Error(`unexpected group ${group}`);
      });
      return { get };
    }),
    getAll: vi.fn(async (...refs: Array<{ oid: string }>): Promise<DocSnap[]> =>
      refs.map((r) => ({
        id: r.oid,
        exists: offeringIds.has(r.oid),
        data: () => (offeringIds.has(r.oid) ? { oid: r.oid, pricingTiers: [] } : undefined),
      })),
    ),
  };

  return db;
}

const fam = (over: Partial<FamilySeed> & { fid: string; name: string }): FamilySeed => ({
  location: 'Brampton',
  legacyFid: null,
  members: [{ firstName: 'A', lastName: 'One', type: 'Adult' }],
  enrollments: [],
  donations: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildRosterCsvRows', () => {
  it('emits one row per member (N=2: a family with 2 members → 2 rows)', async () => {
    const families = [
      fam({
        fid: 'CMT-TWO',
        name: 'Two Members',
        members: [
          { firstName: 'Ravi', lastName: 'Patel', type: 'Child', schoolGrade: '3' },
          { firstName: 'Mira', lastName: 'Patel', type: 'Adult' },
        ],
      }),
    ];
    mockFirestore.mockReturnValue(makeDb(families) as never);

    const rows = await buildRosterCsvRows({});
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.memberName)).toEqual(['Ravi Patel', 'Mira Patel']);
    expect(rows.every((r) => r.fid === 'CMT-TWO')).toBe(true);
    expect(rows[0]!.grade).toBe('3');
    expect(rows[1]!.grade).toBe('');
    expect(rows[0]!.type).toBe('Child');
  });

  it('lists only ACTIVE enrollment labels, joined by "; ", without duplicating the family', async () => {
    const families = [
      fam({
        fid: 'CMT-ACT',
        name: 'Active Family',
        members: [{ firstName: 'Sam', lastName: 'Roy', type: 'Child' }],
        enrollments: [
          { oid: 'off-bv', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active' },
          { oid: 'off-tabla', programKey: 'tabla', programLabel: 'Tabla', status: 'active' },
          { oid: 'off-old', programKey: 'gita', programLabel: 'Gita Chanting', status: 'cancelled' },
        ],
      }),
    ];
    mockFirestore.mockReturnValue(makeDb(families) as never);

    const rows = await buildRosterCsvRows({});
    expect(rows).toHaveLength(1); // one member, family not duplicated by enrollment count
    expect(rows[0]!.programs).toBe('Bala Vihar; Tabla');
    expect(rows[0]!.programs).not.toContain('Gita Chanting');
  });

  it('payment: covered → paid, short → outstanding, no active enrollments → unknown', async () => {
    const families = [
      fam({
        fid: 'CMT-PAID',
        name: 'A Paid',
        enrollments: [
          { oid: 'off-1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active' },
          { oid: 'off-2', programKey: 'tabla', programLabel: 'Tabla', status: 'active' },
        ],
        donations: [{ status: 'completed', amountCAD: 200 }], // expected 100*2 = 200
      }),
      fam({
        fid: 'CMT-SHORT',
        name: 'B Short',
        enrollments: [
          { oid: 'off-3', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active' },
        ],
        donations: [{ status: 'completed', amountCAD: 50 }], // expected 100, short
      }),
      fam({
        fid: 'CMT-NONE',
        name: 'C None',
        enrollments: [
          { oid: 'off-4', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'cancelled' },
        ],
        donations: [{ status: 'completed', amountCAD: 999 }],
      }),
    ];
    mockFirestore.mockReturnValue(makeDb(families) as never);

    const rows = await buildRosterCsvRows({});
    const byFid = (fid: string) => rows.find((r) => r.fid === fid)!;
    expect(byFid('CMT-PAID').payment).toBe('paid');
    expect(byFid('CMT-SHORT').payment).toBe('outstanding');
    expect(byFid('CMT-NONE').payment).toBe('unknown');
  });

  it('program filter: only families with an active enrollment in that programKey appear', async () => {
    const families = [
      fam({
        fid: 'CMT-BV',
        name: 'Has BV',
        enrollments: [
          { oid: 'off-bv', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active' },
        ],
      }),
      fam({
        fid: 'CMT-TABLA',
        name: 'Tabla Only',
        enrollments: [
          { oid: 'off-tabla', programKey: 'tabla', programLabel: 'Tabla', status: 'active' },
        ],
      }),
      fam({
        fid: 'CMT-STALE',
        name: 'Cancelled BV',
        enrollments: [
          { oid: 'off-x', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'cancelled' },
        ],
      }),
    ];
    mockFirestore.mockReturnValue(makeDb(families) as never);

    const rows = await buildRosterCsvRows({ program: 'bala-vihar' });
    const fids = new Set(rows.map((r) => r.fid));
    expect(fids.has('CMT-BV')).toBe(true);
    expect(fids.has('CMT-TABLA')).toBe(false);
    expect(fids.has('CMT-STALE')).toBe(false); // active-only filter
  });

  it('honors the override amount over the resolved offering amount', async () => {
    const families = [
      fam({
        fid: 'CMT-OVR',
        name: 'Override',
        enrollments: [
          {
            oid: 'off-ovr',
            programKey: 'bala-vihar',
            programLabel: 'Bala Vihar',
            status: 'active',
            suggestedAmountOverride: 300,
          },
        ],
        donations: [{ status: 'completed', amountCAD: 250 }], // < 300 override → outstanding
      }),
    ];
    mockFirestore.mockReturnValue(makeDb(families) as never);

    const rows = await buildRosterCsvRows({});
    expect(rows[0]!.payment).toBe('outstanding');
  });
});
