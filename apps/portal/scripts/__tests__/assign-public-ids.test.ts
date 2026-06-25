import { describe, it, expect, beforeEach } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { assignPublicIds, type Allocators } from '../assign-public-ids';

// ── Minimal in-memory Firestore for the families/{fid}/members/{mid} shape ────
// Supports exactly what assignPublicIds touches:
//   db.collection('families').orderBy(field,'asc').get()
//   db.collection('families').where('fid','==',x).orderBy(field,'asc').get()
//   famDoc.ref.collection('members').orderBy(field,'asc').get()
//   doc.ref.update(patch)  (mutates the backing store in place)

interface MemberDoc {
  data: Record<string, unknown>;
}
interface FamilyDoc {
  fid: string;
  data: Record<string, unknown>;
  members: Map<string, MemberDoc>;
}

function makeQueryDocs(
  entries: Array<{ id: string; data: Record<string, unknown>; ref: unknown }>,
  field: string,
) {
  const sorted = [...entries].sort((a, b) => {
    const av = a.data[field];
    const bv = b.data[field];
    if (av === bv) return 0;
    return (av as number | string) < (bv as number | string) ? -1 : 1;
  });
  return sorted.map((e) => ({
    id: e.id,
    data: () => e.data,
    ref: e.ref,
  }));
}

function makeFakeDb(families: FamilyDoc[]): Firestore {
  function memberRef(mem: MemberDoc) {
    return {
      update: async (patch: Record<string, unknown>) => {
        Object.assign(mem.data, patch);
      },
    };
  }

  function familyRef(fam: FamilyDoc) {
    return {
      update: async (patch: Record<string, unknown>) => {
        Object.assign(fam.data, patch);
      },
      collection: (name: string) => {
        if (name !== 'members') throw new Error(`unexpected subcollection ${name}`);
        return {
          orderBy: (field: string) => ({
            get: async () => ({
              docs: makeQueryDocs(
                [...fam.members.entries()].map(([id, mem]) => ({
                  id,
                  data: mem.data,
                  ref: memberRef(mem),
                })),
                field,
              ),
            }),
          }),
        };
      },
    };
  }

  function buildFamilyQuery(filter?: { field: string; value: unknown }) {
    return {
      where: (field: string, _op: string, value: unknown) =>
        buildFamilyQuery({ field, value }),
      orderBy: (field: string) => ({
        get: async () => {
          let list = families;
          if (filter) {
            list = families.filter((f) => f.data[filter.field] === filter.value);
          }
          return {
            docs: makeQueryDocs(
              list.map((f) => ({ id: f.fid, data: f.data, ref: familyRef(f) })),
              field,
            ),
          };
        },
      }),
    };
  }

  return {
    collection: (name: string) => {
      if (name !== 'families') throw new Error(`unexpected collection ${name}`);
      return buildFamilyQuery();
    },
  } as unknown as Firestore;
}

// ── Stateful allocator stubs backed by the same counters the real ones use ────
function makeAllocators() {
  const counters = { family: 1001, member: 50001 };
  const allocators: Allocators = {
    allocateFamilyPublicId: async () => String(counters.family++),
    allocateMemberPublicIds: async (count: number) => {
      const out: string[] = [];
      for (let i = 0; i < count; i++) out.push(String(counters.member++));
      return out;
    },
  };
  return { counters, allocators };
}

function makeFixture(): FamilyDoc[] {
  return [
    {
      fid: 'CMT-AAAA',
      data: { fid: 'CMT-AAAA', createdAt: 1 },
      members: new Map<string, MemberDoc>([
        ['m1', { data: { joinedAt: 1 } }],
        ['m2', { data: { joinedAt: 2 } }],
      ]),
    },
    {
      fid: 'CMT-BBBB',
      data: { fid: 'CMT-BBBB', createdAt: 2 },
      members: new Map<string, MemberDoc>([['m3', { data: { joinedAt: 1 } }]]),
    },
  ];
}

beforeEach(() => {
  // fixtures are rebuilt per test below
});

describe('assignPublicIds', () => {
  it('assigns publicFid (1001+) and publicMid (50001+) to records lacking them', async () => {
    const families = makeFixture();
    const db = makeFakeDb(families);
    const { allocators } = makeAllocators();

    const result = await assignPublicIds(db, allocators, {
      dryRun: false,
      limit: null,
      fid: null,
    });

    // oldest family (createdAt:1) gets 1001, next gets 1002
    expect(families[0]!.data.publicFid).toBe('1001');
    expect(families[1]!.data.publicFid).toBe('1002');
    // members allocate in family-then-member order, 50001+
    expect(families[0]!.members.get('m1')!.data.publicMid).toBe('50001');
    expect(families[0]!.members.get('m2')!.data.publicMid).toBe('50002');
    expect(families[1]!.members.get('m3')!.data.publicMid).toBe('50003');

    expect(result.familiesAssigned).toBe(2);
    expect(result.membersAssigned).toBe(3);
    expect(result.rows).toHaveLength(5);
  });

  it('is idempotent: a second run assigns NOTHING and does not advance counters', async () => {
    const families = makeFixture();
    const db = makeFakeDb(families);
    const { counters, allocators } = makeAllocators();

    await assignPublicIds(db, allocators, { dryRun: false, limit: null, fid: null });
    const familyCounterAfterFirst = counters.family;
    const memberCounterAfterFirst = counters.member;
    const fidsAfterFirst = families.map((f) => f.data.publicFid);
    const midsAfterFirst = families.flatMap((f) =>
      [...f.members.values()].map((m) => m.data.publicMid),
    );

    const second = await assignPublicIds(db, allocators, {
      dryRun: false,
      limit: null,
      fid: null,
    });

    // No new ids assigned on the re-run …
    expect(second.familiesAssigned).toBe(0);
    expect(second.membersAssigned).toBe(0);
    expect(second.rows).toHaveLength(0);
    // … counters did not advance for already-stamped records …
    expect(counters.family).toBe(familyCounterAfterFirst);
    expect(counters.member).toBe(memberCounterAfterFirst);
    // … and the stored ids are unchanged.
    expect(families.map((f) => f.data.publicFid)).toEqual(fidsAfterFirst);
    expect(
      families.flatMap((f) => [...f.members.values()].map((m) => m.data.publicMid)),
    ).toEqual(midsAfterFirst);
  });

  it('only assigns to records missing the id (mixed already-stamped fixture)', async () => {
    const families = makeFixture();
    // Pre-stamp the first family + its first member.
    families[0]!.data.publicFid = '1001';
    families[0]!.members.get('m1')!.data.publicMid = '50001';
    const db = makeFakeDb(families);
    const { allocators } = makeAllocators();

    const result = await assignPublicIds(db, allocators, {
      dryRun: false,
      limit: null,
      fid: null,
    });

    // First family untouched; only the second family + the unstamped members get ids.
    expect(families[0]!.data.publicFid).toBe('1001');
    expect(families[0]!.members.get('m1')!.data.publicMid).toBe('50001');
    expect(families[1]!.data.publicFid).toBe('1001'); // fresh counter from the stub
    expect(families[0]!.members.get('m2')!.data.publicMid).toBe('50001');
    expect(result.familiesAssigned).toBe(1);
    expect(result.membersAssigned).toBe(2);
  });

  it('--dry-run writes nothing but reports the planned rows', async () => {
    const families = makeFixture();
    const db = makeFakeDb(families);
    const { counters, allocators } = makeAllocators();

    const result = await assignPublicIds(db, allocators, {
      dryRun: true,
      limit: null,
      fid: null,
    });

    // Nothing persisted to the docs …
    expect(families[0]!.data.publicFid).toBeUndefined();
    expect(families[1]!.data.publicFid).toBeUndefined();
    expect(families[0]!.members.get('m1')!.data.publicMid).toBeUndefined();
    // … but the plan still reflects what WOULD be assigned.
    expect(result.familiesAssigned).toBe(2);
    expect(result.membersAssigned).toBe(3);
    expect(result.rows).toHaveLength(5);
    // Counters DO advance in dry-run (allocation is real); that's why dry-run is
    // a read-only preview, not a rehearsal of the exact ids. Documented here.
    expect(counters.family).toBe(1003);
  });

  it('--limit N stops after N families', async () => {
    const families = makeFixture();
    const db = makeFakeDb(families);
    const { allocators } = makeAllocators();

    const result = await assignPublicIds(db, allocators, {
      dryRun: false,
      limit: 1,
      fid: null,
    });

    expect(result.familiesScanned).toBe(1);
    expect(families[0]!.data.publicFid).toBe('1001');
    expect(families[1]!.data.publicFid).toBeUndefined();
  });

  it('--fid X restricts to a single family', async () => {
    const families = makeFixture();
    const db = makeFakeDb(families);
    const { allocators } = makeAllocators();

    const result = await assignPublicIds(db, allocators, {
      dryRun: false,
      limit: null,
      fid: 'CMT-BBBB',
    });

    expect(result.familiesScanned).toBe(1);
    expect(families[0]!.data.publicFid).toBeUndefined();
    expect(families[1]!.data.publicFid).toBe('1001');
  });
});
