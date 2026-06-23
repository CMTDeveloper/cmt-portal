import { describe, it, expect } from 'vitest';

import { computeYearReadiness } from '../year-readiness';

// ── In-memory fake Firestore ────────────────────────────────────────────────
// computeYearReadiness needs:
//   - collection(name).where(field, op, value)... .limit(n).get()
//   - collection(name).where(...).get()           (levels, in-memory derive)
//   - collection(name).doc(id).get()  with .exists (prasadConfig direct read)
//   - collectionGroup('enrollments').where(...).where(...).limit(n).get()
//   - ops: '==', '>=', '<=', 'in'
// Every doc (top-level or subcollection) is keyed by a unique path string so the
// collectionGroup sweep can find `families/{fid}/enrollments/{id}` docs. This
// mirrors the promote-families fake but adds range/in ops + .limit + .doc().get().

type DocData = Record<string, unknown>;
type Store = Map<string, DocData>;

function lastSegment(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1]!;
}

/** True when `path` is exactly one segment deeper than `prefix`. */
function isDirectChildOf(path: string, prefix: string): boolean {
  if (!path.startsWith(`${prefix}/`)) return false;
  const rest = path.slice(prefix.length + 1);
  return !rest.includes('/');
}

/** A collectionGroup('enrollments') sweep matches any `.../enrollments/{id}` doc. */
function collectionGroupMatch(path: string, group: string): boolean {
  const parts = path.split('/');
  return parts.length >= 4 && parts[parts.length - 2] === group;
}

function passesFilter(data: DocData, field: string, op: string, value: unknown): boolean {
  const actual = data[field];
  switch (op) {
    case '==':
      return actual === value;
    case '>=':
      return String(actual) >= String(value);
    case '<=':
      return String(actual) <= String(value);
    case 'in':
      return Array.isArray(value) && value.includes(actual);
    default:
      throw new Error(`unsupported op in fake: ${op}`);
  }
}

class FakeQuery {
  constructor(
    private readonly store: Store,
    private readonly predicate: (path: string) => boolean,
    private readonly filters: Array<[string, string, unknown]>,
    private readonly limitN: number | null = null,
  ) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.store, this.predicate, [...this.filters, [field, op, value]], this.limitN);
  }

  limit(n: number): FakeQuery {
    return new FakeQuery(this.store, this.predicate, this.filters, n);
  }

  async get() {
    let docs = [...this.store.entries()]
      .filter(([path]) => this.predicate(path))
      .filter(([, data]) =>
        this.filters.every(([field, op, value]) => passesFilter(data, field, op, value)),
      )
      .map(([path, data]) => ({ id: lastSegment(path), data: () => data }));
    if (this.limitN != null) docs = docs.slice(0, this.limitN);
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class FakeCollection {
  // prefix is the full path up to (and including) this collection name.
  constructor(private readonly store: Store, private readonly prefix: string) {}

  doc(id: string) {
    const path = `${this.prefix}/${id}`;
    return {
      get: async () => {
        const data = this.store.get(path);
        return data
          ? { exists: true, id, data: () => data }
          : { exists: false, id, data: () => undefined };
      },
    };
  }

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(
      this.store,
      (path) => isDirectChildOf(path, this.prefix),
      [[field, op, value]],
    );
  }
}

function makeFakeDb() {
  const store: Store = new Map();
  const db = {
    collection: (name: string) => new FakeCollection(store, name),
    collectionGroup: (name: string) =>
      new FakeQuery(store, (path) => collectionGroupMatch(path, name), []),
  } as unknown as FirebaseFirestore.Firestore;

  const seed = (collection: string, id: string, data: DocData) => {
    const path = `${collection}/${id}`;
    store.set(path, { ...data, __id: id, __path: path });
  };
  const seedSub = (fid: string, sub: string, id: string, data: DocData) => {
    const path = `families/${fid}/${sub}/${id}`;
    store.set(path, { ...data, __id: id, __path: path });
  };
  return { db, seed, seedSub };
}

describe('computeYearReadiness', () => {
  it('reports offerings + promotionRan true (others false) from the seeded year', async () => {
    const fake = makeFakeDb();
    // A target-year BV offering → offerings: true.
    fake.seed('offerings', 'bv-brampton-2026-27', {
      oid: 'bv-brampton-2026-27',
      programKey: 'bala-vihar',
      termLabel: '2026-27',
    });
    // An active target-year enrollment → promotionRan: true (collectionGroup + in + ==).
    fake.seedSub('F1', 'enrollments', 'F1-bv-brampton-2026-27', {
      oid: 'bv-brampton-2026-27',
      status: 'active',
      fid: 'F1',
    });

    const r = await computeYearReadiness(fake.db, { fromYear: '2025-26', toYear: '2026-27' });

    expect(r).toMatchObject({
      toYear: '2026-27',
      offerings: true,
      promotionRan: true,
      levels: false,
      calendar: false,
      teachers: false,
      prasad: false,
      seva: false,
    });
  });

  it('reports every signal true when all next-year setup is present', async () => {
    const fake = makeFakeDb();
    fake.seed('offerings', 'bv-brampton-2026-27', {
      oid: 'bv-brampton-2026-27',
      programKey: 'bala-vihar',
      termLabel: '2026-27',
    });
    // level for the toYear oid, WITH a teacher assigned → levels + teachers true.
    fake.seed('levels', 'brampton-level-2-bv-brampton-2026-27', {
      pid: 'bv-brampton-2026-27',
      teacherRefs: ['T1'],
    });
    // calendar entry inside the 2026-27 window (Aug 1 2026 .. Jul 31 2027).
    fake.seed('classCalendarEntries', 'bv-brampton-2026-09-06', {
      programKey: 'bala-vihar',
      date: '2026-09-06',
    });
    // prasadConfig keyed by the toYear oid (pid == offering oid).
    fake.seed('prasadConfig', 'bv-brampton-2026-27', { cap: 4 });
    // seva opportunity for the toYear.
    fake.seed('seva_opportunities', 'opp-1', { sevaYear: '2026-27' });
    // active enrollment → promotionRan.
    fake.seedSub('F1', 'enrollments', 'F1-bv-brampton-2026-27', {
      oid: 'bv-brampton-2026-27',
      status: 'active',
      fid: 'F1',
    });

    const r = await computeYearReadiness(fake.db, { fromYear: '2025-26', toYear: '2026-27' });

    expect(r).toMatchObject({
      toYear: '2026-27',
      offerings: true,
      levels: true,
      teachers: true,
      calendar: true,
      prasad: true,
      seva: true,
      promotionRan: true,
    });
  });

  it('levels true but teachers false when no level has teacherRefs', async () => {
    const fake = makeFakeDb();
    fake.seed('levels', 'brampton-level-2-bv-brampton-2026-27', {
      pid: 'bv-brampton-2026-27',
      teacherRefs: [],
    });

    const r = await computeYearReadiness(fake.db, { fromYear: '2025-26', toYear: '2026-27' });

    expect(r.levels).toBe(true);
    expect(r.teachers).toBe(false);
  });

  it('all false when nothing for the next year is set up', async () => {
    const fake = makeFakeDb();
    // Seed only PRIOR-year data — none of it should satisfy a toYear signal.
    fake.seed('offerings', 'bv-brampton-2025-26', {
      oid: 'bv-brampton-2025-26',
      programKey: 'bala-vihar',
      termLabel: '2025-26',
    });
    fake.seedSub('F1', 'enrollments', 'F1-bv-brampton-2025-26', {
      oid: 'bv-brampton-2025-26',
      status: 'active',
      fid: 'F1',
    });

    const r = await computeYearReadiness(fake.db, { fromYear: '2025-26', toYear: '2026-27' });

    expect(r).toMatchObject({
      toYear: '2026-27',
      offerings: false,
      levels: false,
      teachers: false,
      calendar: false,
      prasad: false,
      seva: false,
      promotionRan: false,
    });
  });
});
