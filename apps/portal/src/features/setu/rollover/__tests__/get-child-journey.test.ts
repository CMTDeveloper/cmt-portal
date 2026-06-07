import { describe, it, expect } from 'vitest';
import { getChildBalaViharJourney } from '../get-child-journey';

// ── In-memory fake Firestore ────────────────────────────────────────────────
// Trimmed from promote-families.test.ts to the surface getChildBalaViharJourney
// needs:
//   - collection('families').doc(fid).collection('enrollments').get()
//   - collection('levels').where('pid','==',pid).get()

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

class FakeQuery {
  constructor(
    private readonly store: Store,
    private readonly predicate: (path: string) => boolean,
    private readonly filters: Array<[string, string, unknown]>,
  ) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.store, this.predicate, [...this.filters, [field, op, value]]);
  }

  async get() {
    const docs = [...this.store.entries()]
      .filter(([path]) => this.predicate(path))
      .filter(([, data]) => this.filters.every(([field, , value]) => data[field] === value))
      .map(([path, data]) => ({ id: lastSegment(path), data: () => data }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class FakeCollection {
  constructor(private readonly store: Store, private readonly prefix: string) {}

  doc(id: string) {
    const path = `${this.prefix}/${id}`;
    return {
      collection: (sub: string) => new FakeCollection(this.store, `${path}/${sub}`),
    };
  }

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.store, (path) => isDirectChildOf(path, this.prefix), [[field, op, value]]);
  }

  async get() {
    const docs = [...this.store.entries()]
      .filter(([path]) => isDirectChildOf(path, this.prefix))
      .map(([path, data]) => ({ id: lastSegment(path), data: () => data }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

function makeFakeDb() {
  const store: Store = new Map();
  const db = {
    collection: (name: string) => new FakeCollection(store, name),
  } as unknown as FirebaseFirestore.Firestore;

  const seed = (collection: string, id: string, data: DocData) => {
    store.set(`${collection}/${id}`, { ...data, __id: id });
  };
  const seedSub = (fid: string, sub: string, id: string, data: DocData) => {
    store.set(`families/${fid}/${sub}/${id}`, { ...data, __id: id });
  };
  return { db, seed, seedSub };
}

describe('getChildBalaViharJourney', () => {
  it('returns two rows newest-first when a year was promoted (snapshots present)', async () => {
    const fake = makeFakeDb();
    // Closed 2025-26 — child sat in Grade 3 / Level 2.
    fake.seedSub('F1', 'enrollments', 'F1-bv-brampton-2025-26', {
      eid: 'F1-bv-brampton-2025-26',
      fid: 'F1',
      oid: 'bv-brampton-2025-26',
      pid: 'bv-brampton-2025-26',
      programKey: 'bala-vihar',
      termLabel: '2025-26',
      status: 'cancelled',
      enrolledMids: ['F1-02'],
      levelSnapshots: {
        'F1-02': { schoolGrade: '3', levelId: 'lvl-2-2025', levelName: 'Level 2' },
      },
    });
    // Active 2026-27 — promoted into Grade 4 / Level 3.
    fake.seedSub('F1', 'enrollments', 'F1-bv-brampton-2026-27', {
      eid: 'F1-bv-brampton-2026-27',
      fid: 'F1',
      oid: 'bv-brampton-2026-27',
      pid: 'bv-brampton-2026-27',
      programKey: 'bala-vihar',
      termLabel: '2026-27',
      status: 'active',
      enrolledMids: ['F1-02'],
      levelSnapshots: {
        'F1-02': { schoolGrade: '4', levelId: 'lvl-3-2026', levelName: 'Level 3' },
      },
    });

    const rows = await getChildBalaViharJourney(fake.db, {
      fid: 'F1',
      mid: 'F1-02',
      member: { schoolGrade: '4', birthMonthYear: null },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ termLabel: '2026-27', schoolGrade: '4', levelName: 'Level 3', active: true });
    expect(rows[1]).toEqual({ termLabel: '2025-26', schoolGrade: '3', levelName: 'Level 2', active: false });
  });

  it('derives the active row live when the current year has no snapshot yet (pre-promotion)', async () => {
    const fake = makeFakeDb();
    fake.seed('levels', 'brampton-level-2-bv-brampton-2025-26', {
      levelId: 'brampton-level-2-bv-brampton-2025-26',
      levelName: 'Level 2',
      levelKind: 'level',
      gradeBand: ['2', '3'],
      pid: 'bv-brampton-2025-26',
    });
    fake.seedSub('F2', 'enrollments', 'F2-bv-brampton-2025-26', {
      eid: 'F2-bv-brampton-2025-26',
      fid: 'F2',
      oid: 'bv-brampton-2025-26',
      pid: 'bv-brampton-2025-26',
      programKey: 'bala-vihar',
      termLabel: '2025-26',
      status: 'active',
      enrolledMids: ['F2-02'],
      // no levelSnapshots — pre-promotion current year
    });

    const rows = await getChildBalaViharJourney(fake.db, {
      fid: 'F2',
      mid: 'F2-02',
      member: { schoolGrade: '3', birthMonthYear: null },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ termLabel: '2025-26', schoolGrade: '3', levelName: 'Level 2', active: true });
  });

  it('returns [] for a child with no Bala Vihar enrollments', async () => {
    const fake = makeFakeDb();
    // A non-BV enrollment the child IS in — must be ignored.
    fake.seedSub('F3', 'enrollments', 'F3-tabla-2025-26', {
      eid: 'F3-tabla-2025-26',
      fid: 'F3',
      oid: 'tabla-2025-26',
      pid: 'tabla-2025-26',
      programKey: 'tabla',
      termLabel: '2025-26',
      status: 'active',
      enrolledMids: ['F3-02'],
    });

    const rows = await getChildBalaViharJourney(fake.db, {
      fid: 'F3',
      mid: 'F3-02',
      member: { schoolGrade: '3', birthMonthYear: null },
    });

    expect(rows).toEqual([]);
  });
});
