import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
}));

vi.mock('../payment', () => ({ deriveFamilyPayment: vi.fn().mockResolvedValue('unknown') }));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { listRosterFamilies } from '../list-families';

const mockFirestore = vi.mocked(portalFirestore);

type Json = Record<string, unknown>;

interface FamilySeed {
  fid: string;
  name: string;
  location: string;
  legacyFid: string | null;
  members: number;
  // active enrollments: { programKey, programLabel }
  enrollments: Array<{ programKey: string; programLabel: string; status: string }>;
}

interface DocSnap {
  id: string;
  exists: boolean;
  data: () => Json | undefined;
}

interface QuerySnap {
  docs: Array<{ id: string; data: () => Json }>;
}

function docSnap(id: string, data: Json | undefined): DocSnap {
  return { id, exists: data !== undefined, data: () => data };
}

/**
 * Hand-built chainable Firestore fake.
 *
 * A query "builder" records its target collection + accumulated filters (where
 * + orderBy + startAfter) and resolves against the in-memory `families` array
 * on `.get()`. The same builder shape backs the top-level ordered/filtered
 * query AND `.count()`. Subcollections (`members`, `enrollments`) are answered
 * from the parent family's seed. `collectionGroup('enrollments')` flattens
 * every family's active enrollments into `{ fid }` rows. `getAll(...refs)`
 * resolves each ref to a doc snapshot.
 */
function makeDb(families: FamilySeed[]) {
  const byFid = new Map(families.map((f) => [f.fid, f]));

  function familyData(f: FamilySeed): Json {
    return {
      fid: f.fid,
      name: f.name,
      location: f.location,
      legacyFid: f.legacyFid,
    };
  }

  // Records a ref to a single family doc so getAll can resolve it later.
  function familyDocRef(fid: string) {
    return { __kind: 'familyDoc' as const, fid };
  }

  type QueryState = { location?: string; startAfterFid?: string; orderedFields?: string[] };

  // Mirror the real Admin SDK: ordering by the same field twice throws. Without
  // this guard the fake would silently accept `orderBy('name').where(...).orderBy('name')`,
  // which 500s in production.
  function orderByOrThrow(state: QueryState, field: string): QueryState {
    if (state.orderedFields?.includes(field)) {
      throw new Error(
        `Invalid query. You cannot specify the same field '${field}' multiple times in the order by clause.`,
      );
    }
    return { ...state, orderedFields: [...(state.orderedFields ?? []), field] };
  }

  function makeQuery(state: QueryState) {
    const builder = {
      where: vi.fn((field: string, _op: string, value: unknown) => {
        if (field === 'location') return makeQuery({ ...state, location: String(value) });
        return makeQuery(state);
      }),
      orderBy: vi.fn((field: string) => makeQuery(orderByOrThrow(state, field))),
      startAfter: vi.fn((snap: DocSnap) => makeQuery({ ...state, startAfterFid: snap.id })),
      limit: vi.fn((_n: number) => ({
        get: vi.fn(async (): Promise<QuerySnap> => resolve(state, _n)),
      })),
      count: vi.fn(() => ({
        get: vi.fn(async () => ({ data: () => ({ count: resolveAll(state).length }) })),
      })),
      get: vi.fn(async (): Promise<QuerySnap> => resolve(state)),
    };
    return builder;
  }

  function resolveAll(state: QueryState): FamilySeed[] {
    let rows = [...families];
    if (state.location) rows = rows.filter((f) => f.location === state.location);
    // orderBy('name') ascending, with implicit __name__ (fid) tiebreaker
    rows.sort((a, b) => {
      const c = a.name.localeCompare(b.name);
      return c !== 0 ? c : a.fid.localeCompare(b.fid);
    });
    if (state.startAfterFid) {
      const idx = rows.findIndex((f) => f.fid === state.startAfterFid);
      if (idx >= 0) rows = rows.slice(idx + 1);
    }
    return rows;
  }

  function resolve(state: QueryState, lim?: number): QuerySnap {
    let rows = resolveAll(state);
    if (typeof lim === 'number') rows = rows.slice(0, lim);
    return { docs: rows.map((f) => ({ id: f.fid, data: () => familyData(f) })) };
  }

  const db = {
    collection: vi.fn((col: string) => {
      if (col !== 'families') throw new Error(`unexpected collection ${col}`);
      const collApi = {
        doc: vi.fn((fid: string) => ({
          // cursor resume read
          get: vi.fn(async (): Promise<DocSnap> => {
            const f = byFid.get(fid);
            return docSnap(fid, f ? familyData(f) : undefined);
          }),
          collection: vi.fn((sub: string) => {
            const f = byFid.get(fid);
            if (sub === 'members') {
              return {
                limit: vi.fn(() => ({
                  get: vi.fn(async (): Promise<QuerySnap> => ({
                    docs: Array.from({ length: f?.members ?? 0 }, (_, i) => ({
                      id: `${fid}-m-${i}`,
                      data: () => ({ mid: `${fid}-m-${i}` }),
                    })),
                  })),
                })),
              };
            }
            // sub === 'enrollments'
            return {
              where: vi.fn((_field: string, _op: string, value: unknown) => ({
                get: vi.fn(async (): Promise<QuerySnap> => {
                  const active = (f?.enrollments ?? []).filter((e) => e.status === String(value));
                  return {
                    docs: active.map((e, i) => ({
                      id: `${fid}-e-${i}`,
                      data: () => ({ programKey: e.programKey, programLabel: e.programLabel, status: e.status }),
                    })),
                  };
                }),
              })),
            };
          }),
          // marker so getAll can identify the ref
          ...familyDocRef(fid),
        })),
        where: vi.fn((field: string, _op: string, value: unknown) =>
          field === 'location' ? makeQuery({ location: String(value) }) : makeQuery({}),
        ),
        orderBy: vi.fn((field: string) => makeQuery(orderByOrThrow({}, field))),
        count: vi.fn(() => ({
          get: vi.fn(async () => ({ data: () => ({ count: families.length }) })),
        })),
      };
      return collApi;
    }),
    collectionGroup: vi.fn((group: string) => {
      if (group !== 'enrollments') throw new Error(`unexpected group ${group}`);
      let programKey: string | undefined;
      let status: string | undefined;
      const cg = {
        where: vi.fn((field: string, _op: string, value: unknown) => {
          if (field === 'programKey') programKey = String(value);
          if (field === 'status') status = String(value);
          return cg;
        }),
        get: vi.fn(async (): Promise<QuerySnap> => {
          const rows: Array<{ id: string; data: () => Json }> = [];
          for (const f of families) {
            f.enrollments.forEach((e, i) => {
              if (programKey && e.programKey !== programKey) return;
              if (status && e.status !== status) return;
              rows.push({ id: `${f.fid}-e-${i}`, data: () => ({ fid: f.fid }) });
            });
          }
          return { docs: rows };
        }),
      };
      return cg;
    }),
    getAll: vi.fn(async (...refs: Array<{ fid: string }>): Promise<DocSnap[]> =>
      refs.map((r) => {
        const f = byFid.get(r.fid);
        return docSnap(r.fid, f ? familyData(f) : undefined);
      }),
    ),
  };

  return db;
}

const fam = (over: Partial<FamilySeed> & { fid: string; name: string }): FamilySeed => ({
  location: 'Brampton',
  legacyFid: null,
  members: 1,
  enrollments: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listRosterFamilies', () => {
  it('orders by name ascending and paginates by fid cursor (limit honored, nextCursor set)', async () => {
    const families = [
      fam({ fid: 'CMT-B', name: 'Brown' }),
      fam({ fid: 'CMT-A', name: 'Adams' }),
      fam({ fid: 'CMT-C', name: 'Clark' }),
    ];
    mockFirestore.mockReturnValue(makeDb(families) as never);

    const page1 = await listRosterFamilies({ limit: 2, format: 'json' });
    expect(page1.families.map((f) => f.name)).toEqual(['Adams', 'Brown']);
    expect(page1.nextCursor).toBe(page1.families[1]!.fid);

    const page2 = await listRosterFamilies({ limit: 2, cursor: page1.nextCursor!, format: 'json' });
    expect(page2.families.map((f) => f.name)).toEqual(['Clark']);
    expect(page2.nextCursor).toBeNull();
  });

  it('location filter returns only matching families', async () => {
    const families = [
      fam({ fid: 'CMT-1', name: 'Adams', location: 'Mississauga' }),
      fam({ fid: 'CMT-2', name: 'Brown', location: 'Brampton' }),
      fam({ fid: 'CMT-3', name: 'Clark', location: 'Mississauga' }),
    ];
    mockFirestore.mockReturnValue(makeDb(families) as never);

    const res = await listRosterFamilies({ location: 'Mississauga', limit: 50, format: 'json' });
    expect(res.families.length).toBe(2);
    expect(res.families.every((f) => f.location === 'Mississauga')).toBe(true);
  });

  it('program filter intersects via collectionGroup; a family with TWO active enrollments appears ONCE (N=2)', async () => {
    const families = [
      fam({
        fid: 'CMT-TWO',
        name: 'Two Enrollments',
        enrollments: [
          { programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active' },
          { programKey: 'bala-vihar', programLabel: 'Bala Vihar Gr 3', status: 'active' },
        ],
      }),
      fam({
        fid: 'CMT-OTHER',
        name: 'Other Program',
        enrollments: [{ programKey: 'tabla', programLabel: 'Tabla', status: 'active' }],
      }),
    ];
    mockFirestore.mockReturnValue(makeDb(families) as never);

    const res = await listRosterFamilies({ program: 'bala-vihar', limit: 50, format: 'json' });
    const dupes = res.families.filter((f) => f.fid === 'CMT-TWO');
    expect(dupes).toHaveLength(1);
    expect(res.families.some((f) => f.fid === 'CMT-OTHER')).toBe(false);
  });

  it('reports memberCount from the members subcollection', async () => {
    const families = [
      fam({ fid: 'CMT-FOUR', name: 'Four Members', members: 4 }),
      fam({ fid: 'CMT-ONE', name: 'One Member', members: 1 }),
    ];
    mockFirestore.mockReturnValue(makeDb(families) as never);

    const res = await listRosterFamilies({ limit: 50, format: 'json' });
    const target = res.families.find((f) => f.fid === 'CMT-FOUR');
    expect(target?.memberCount).toBe(4);
  });

  it('returns total only on the first page (no cursor)', async () => {
    const families = [
      fam({ fid: 'CMT-A', name: 'Adams' }),
      fam({ fid: 'CMT-B', name: 'Brown' }),
      fam({ fid: 'CMT-C', name: 'Clark' }),
    ];
    mockFirestore.mockReturnValue(makeDb(families) as never);

    const first = await listRosterFamilies({ limit: 2, format: 'json' });
    expect(typeof first.total).toBe('number');
    expect(first.total).toBe(3);

    const next = await listRosterFamilies({ limit: 2, cursor: first.nextCursor!, format: 'json' });
    expect(next.total).toBeNull();
  });
});
