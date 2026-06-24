import { describe, it, expect, beforeEach, vi } from 'vitest';

// FieldValue.serverTimestamp() must return a recognizable sentinel so the
// in-memory fake can store it without needing a real Firestore.
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__serverTimestamp__' },
}));

import { prefillTeachers } from '../prefill-teachers';

// ── In-memory fake Firestore ────────────────────────────────────────────────
// Backs collection().doc().get()/set() and a single-field
// .where('pid','in',[...]).get(). prefillTeachers only ever issues an `in`
// query on `pid` (the source-level scan) plus per-doc id reads/writes, so the
// fake captures the where filter and returns the seeded docs that match.

type DocData = Record<string, unknown>;

interface WhereFilter {
  field: string;
  op: string;
  value: unknown;
}

class FakeCollection {
  constructor(private readonly store: Map<string, DocData>) {}

  doc(id: string) {
    return {
      get: async () => {
        const data = this.store.get(id);
        return data
          ? { exists: true, id, data: () => data }
          : { exists: false, id, data: () => undefined };
      },
      set: async (value: DocData, _opts?: { merge?: boolean }) => {
        const prev = this.store.get(id) ?? { __id: id };
        // merge semantics: shallow-merge over the existing doc (prefillTeachers
        // always calls set(..., { merge: true })).
        this.store.set(id, { ...prev, ...value, __id: id });
      },
    };
  }

  where(field: string, op: string, value: unknown) {
    return this.#query({ field, op, value });
  }

  #query(filter: WhereFilter) {
    const matches = () => {
      const all = [...this.store.values()];
      if (filter.op === 'in' && Array.isArray(filter.value)) {
        const set = new Set(filter.value as unknown[]);
        return all.filter((d) => set.has(d[filter.field]));
      }
      return all.filter((d) => d[filter.field] === filter.value);
    };
    return {
      get: async () => {
        const docs = matches().map((data) => ({
          id: String(data['__id']),
          exists: true,
          data: () => data,
        }));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
  }
}

function makeFakeDb() {
  const collections: Record<string, Map<string, DocData>> = {};
  const storeFor = (name: string) => (collections[name] ??= new Map<string, DocData>());
  const db = {
    collection: (name: string) => new FakeCollection(storeFor(name)),
  } as unknown as FirebaseFirestore.Firestore;
  const seed = (collection: string, id: string, data: DocData) => {
    storeFor(collection).set(id, { ...data, __id: id });
  };
  const read = (collection: string, id: string) => storeFor(collection).get(id);
  return { db, seed, read };
}

const ARGS = { fromYear: '2025-26', toYear: '2026-27', dryRun: false, actorMid: 'admin1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('prefillTeachers', () => {
  it('copies a source level teacherRefs into its empty next-year twin', async () => {
    const fake = makeFakeDb();
    fake.seed('levels', 'brampton-grade1-bv-brampton-2025-26', {
      levelId: 'brampton-grade1-bv-brampton-2025-26',
      pid: 'bv-brampton-2025-26',
      teacherRefs: ['t1', 't2'],
    });
    fake.seed('levels', 'brampton-grade1-bv-brampton-2026-27', {
      levelId: 'brampton-grade1-bv-brampton-2026-27',
      pid: 'bv-brampton-2026-27',
      teacherRefs: [],
    });

    const result = await prefillTeachers(fake.db, ARGS);

    expect(result.filled).toEqual(['brampton-grade1-bv-brampton-2026-27']);
    expect(result.skipped).toEqual([]);

    const target = fake.read('levels', 'brampton-grade1-bv-brampton-2026-27');
    expect(target!['teacherRefs']).toEqual(['t1', 't2']);
    expect(target!['updatedBy']).toBe('admin1');
    expect(target!['updatedAt']).toBe('__serverTimestamp__');
  });

  it('never clobbers a target that already has teacherRefs (goes to skipped)', async () => {
    const fake = makeFakeDb();
    fake.seed('levels', 'brampton-grade1-bv-brampton-2025-26', {
      levelId: 'brampton-grade1-bv-brampton-2025-26',
      pid: 'bv-brampton-2025-26',
      teacherRefs: ['t1', 't2'],
    });
    fake.seed('levels', 'brampton-grade1-bv-brampton-2026-27', {
      levelId: 'brampton-grade1-bv-brampton-2026-27',
      pid: 'bv-brampton-2026-27',
      teacherRefs: ['x'],
    });

    const result = await prefillTeachers(fake.db, ARGS);

    expect(result.filled).toEqual([]);
    expect(result.skipped).toEqual(['brampton-grade1-bv-brampton-2026-27']);

    // unchanged — the admin assignment survives
    const target = fake.read('levels', 'brampton-grade1-bv-brampton-2026-27');
    expect(target!['teacherRefs']).toEqual(['x']);
    expect(target!['updatedBy']).toBeUndefined();
  });

  it('contributes nothing for a source level with empty teacherRefs', async () => {
    const fake = makeFakeDb();
    fake.seed('levels', 'brampton-grade1-bv-brampton-2025-26', {
      levelId: 'brampton-grade1-bv-brampton-2025-26',
      pid: 'bv-brampton-2025-26',
      teacherRefs: [],
    });
    fake.seed('levels', 'brampton-grade1-bv-brampton-2026-27', {
      levelId: 'brampton-grade1-bv-brampton-2026-27',
      pid: 'bv-brampton-2026-27',
      teacherRefs: [],
    });

    const result = await prefillTeachers(fake.db, ARGS);

    expect(result.filled).toEqual([]);
    expect(result.skipped).toEqual([]);

    const target = fake.read('levels', 'brampton-grade1-bv-brampton-2026-27');
    expect(target!['teacherRefs']).toEqual([]);
    expect(target!['updatedBy']).toBeUndefined();
  });

  it('dry-run reports would-fill ids but writes nothing', async () => {
    const fake = makeFakeDb();
    fake.seed('levels', 'brampton-grade1-bv-brampton-2025-26', {
      levelId: 'brampton-grade1-bv-brampton-2025-26',
      pid: 'bv-brampton-2025-26',
      teacherRefs: ['t1', 't2'],
    });
    fake.seed('levels', 'brampton-grade1-bv-brampton-2026-27', {
      levelId: 'brampton-grade1-bv-brampton-2026-27',
      pid: 'bv-brampton-2026-27',
      teacherRefs: [],
    });

    const result = await prefillTeachers(fake.db, { ...ARGS, dryRun: true });

    expect(result.filled).toEqual(['brampton-grade1-bv-brampton-2026-27']);
    const target = fake.read('levels', 'brampton-grade1-bv-brampton-2026-27');
    expect(target!['teacherRefs']).toEqual([]); // untouched
    expect(target!['updatedBy']).toBeUndefined();
  });

  it('skips a source whose next-year twin does not exist', async () => {
    const fake = makeFakeDb();
    fake.seed('levels', 'brampton-grade1-bv-brampton-2025-26', {
      levelId: 'brampton-grade1-bv-brampton-2025-26',
      pid: 'bv-brampton-2025-26',
      teacherRefs: ['t1'],
    });
    // no target seeded

    const result = await prefillTeachers(fake.db, ARGS);

    expect(result.filled).toEqual([]);
    expect(result.skipped).toEqual(['brampton-grade1-bv-brampton-2026-27']);
  });
});
