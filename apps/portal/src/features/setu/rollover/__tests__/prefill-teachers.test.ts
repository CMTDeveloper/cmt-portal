import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock @cmt/firebase-shared/admin/firestore ───────────────────────────────
// prefillTeachers routes each carried-forward ref through assignTeacher (from
// `@/features/setu/teacher/assignments`), which reads/writes via
// `portalFirestore()` — NOT the db injected into prefillTeachers. In production
// prefillTeachers is invoked with `db = portalFirestore()`, so the two are the
// SAME instance. The test mirrors that: `portalFirestore()` returns the same
// shared-store fake we pass to prefillTeachers, so a single in-memory store
// backs BOTH `levels.teacherRefs` (level side) and `teacherAssignments.levelIds`
// (assignment side) — letting us assert both are synced.
const hooks = vi.hoisted(() => ({ current: null as null | FirebaseFirestore.Firestore }));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => hooks.current,
  FieldValue: {
    // Recognizable sentinels the fake resolves on merge.
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
    arrayUnion: (...vals: unknown[]) => ({ __sentinel: 'arrayUnion', vals }),
    arrayRemove: (...vals: unknown[]) => ({ __sentinel: 'arrayRemove', vals }),
  },
}));

import { prefillTeachers } from '../prefill-teachers';

// ── In-memory fake Firestore (sentinel-aware, batch-capable) ─────────────────
// Backs collection().doc().get()/set(), collection().where(...).get() for the
// `in` / `==` / `array-contains` ops, and db.batch() — the exact surface
// prefillTeachers + assignTeacher + getTeacherLevelIds touch. FieldValue
// sentinels (serverTimestamp/arrayUnion/arrayRemove) resolve against the prior
// doc on each merged set.

type DocData = Record<string, unknown>;
const SERVER_TS = '__serverTimestamp__';

interface Sentinel {
  __sentinel: 'serverTimestamp' | 'arrayUnion' | 'arrayRemove';
  vals?: unknown[];
}
function isSentinel(v: unknown): v is Sentinel {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && '__sentinel' in v;
}

function makeFakeDb() {
  const collections = new Map<string, Map<string, DocData>>();
  const storeFor = (name: string) => {
    let m = collections.get(name);
    if (!m) collections.set(name, (m = new Map<string, DocData>()));
    return m;
  };

  const applyMerge = (prev: DocData, value: DocData): DocData => {
    const out: DocData = { ...prev };
    for (const [k, v] of Object.entries(value)) {
      if (isSentinel(v)) {
        if (v.__sentinel === 'serverTimestamp') out[k] = SERVER_TS;
        else if (v.__sentinel === 'arrayUnion') {
          const cur = Array.isArray(out[k]) ? [...(out[k] as unknown[])] : [];
          for (const val of v.vals ?? []) if (!cur.includes(val)) cur.push(val);
          out[k] = cur;
        } else {
          const cur = Array.isArray(out[k]) ? (out[k] as unknown[]) : [];
          out[k] = cur.filter((x) => !(v.vals ?? []).includes(x));
        }
      } else {
        out[k] = v;
      }
    }
    return out;
  };

  const docRef = (store: Map<string, DocData>, id: string) => ({
    __id: id,
    get: async () => {
      const data = store.get(id);
      return data
        ? { exists: true, id, data: () => data }
        : { exists: false, id, data: () => undefined };
    },
    set: async (value: DocData, opts?: { merge?: boolean }) => {
      const prev = opts?.merge ? (store.get(id) ?? {}) : {};
      store.set(id, { ...applyMerge(prev, value), __id: id });
    },
  });

  const collection = (name: string) => {
    const store = storeFor(name);
    return {
      doc: (id: string) => docRef(store, id),
      where: (field: string, op: string, value: unknown) => ({
        get: async () => {
          const all = [...store.values()];
          let matched: DocData[];
          if (op === 'in' && Array.isArray(value)) {
            const set = new Set(value as unknown[]);
            matched = all.filter((d) => set.has(d[field]));
          } else if (op === 'array-contains') {
            matched = all.filter(
              (d) => Array.isArray(d[field]) && (d[field] as unknown[]).includes(value),
            );
          } else {
            matched = all.filter((d) => d[field] === value);
          }
          const docs = matched.map((data) => ({
            id: String(data['__id']),
            exists: true,
            data: () => data,
          }));
          return { docs, empty: docs.length === 0, size: docs.length };
        },
      }),
    };
  };

  type BatchOp = {
    ref: { set: (v: DocData, o?: { merge?: boolean }) => Promise<void> };
    value: DocData;
    opts: { merge?: boolean } | undefined;
  };
  const batch = () => {
    const ops: BatchOp[] = [];
    return {
      set: (ref: BatchOp['ref'], value: DocData, opts?: { merge?: boolean }) => {
        ops.push({ ref, value, opts });
      },
      commit: async () => {
        for (const op of ops) await op.ref.set(op.value, op.opts);
      },
    };
  };

  const db = { collection, batch } as unknown as FirebaseFirestore.Firestore;
  const seed = (c: string, id: string, data: DocData) => {
    storeFor(c).set(id, { ...data, __id: id });
  };
  const read = (c: string, id: string) => storeFor(c).get(id);
  return { db, seed, read };
}

/** Fresh shared-store fake, wired so portalFirestore() resolves to it too. */
function newFake() {
  const fake = makeFakeDb();
  hooks.current = fake.db;
  return fake;
}

const ARGS = { fromYear: '2025-26', toYear: '2026-27', dryRun: false, actorMid: 'admin1' };
const SRC = 'brampton-grade1-bv-brampton-2025-26';
const TGT = 'brampton-grade1-bv-brampton-2026-27';

beforeEach(() => {
  vi.clearAllMocks();
  hooks.current = null;
});

describe('prefillTeachers', () => {
  it('copies a source level teacherRefs into its empty next-year twin', async () => {
    const fake = newFake();
    fake.seed('levels', SRC, { levelId: SRC, pid: 'bv-brampton-2025-26', teacherRefs: ['t1', 't2'] });
    fake.seed('levels', TGT, { levelId: TGT, pid: 'bv-brampton-2026-27', teacherRefs: [] });

    const result = await prefillTeachers(fake.db, ARGS);

    expect(result.filled).toEqual([TGT]);
    expect(result.skipped).toEqual([]);

    const target = fake.read('levels', TGT);
    expect(target!['teacherRefs']).toEqual(['t1', 't2']);
    expect(target!['updatedBy']).toBe('admin1');
    expect(target!['updatedAt']).toBe('__serverTimestamp__');
  });

  it('syncs BOTH teacherRefs AND each ref teacherAssignments.levelIds (the fix)', async () => {
    const fake = newFake();
    fake.seed('levels', SRC, {
      levelId: SRC,
      pid: 'bv-brampton-2025-26',
      teacherRefs: ['mid-a', 'mid-b'],
    });
    fake.seed('levels', TGT, { levelId: TGT, pid: 'bv-brampton-2026-27', teacherRefs: [] });
    // Existing assignments list only the SOURCE-year level.
    fake.seed('teacherAssignments', 'mid-a', { ref: 'mid-a', levelIds: [SRC] });
    fake.seed('teacherAssignments', 'mid-b', { ref: 'mid-b', levelIds: [SRC] });

    const result = await prefillTeachers(fake.db, ARGS);
    expect(result.filled).toEqual([TGT]);

    // (a) level side — target carries both mids
    const target = fake.read('levels', TGT);
    expect(target!['teacherRefs']).toEqual(['mid-a', 'mid-b']);

    // (b) assignment side — each ref now ALSO lists the TARGET level (source kept)
    const a = fake.read('teacherAssignments', 'mid-a');
    const b = fake.read('teacherAssignments', 'mid-b');
    expect(a!['levelIds']).toEqual(expect.arrayContaining([SRC, TGT]));
    expect(b!['levelIds']).toEqual(expect.arrayContaining([SRC, TGT]));
    // no duplicates introduced
    expect(a!['levelIds']).toHaveLength(2);
    expect(b!['levelIds']).toHaveLength(2);
    expect(a!['updatedByUid']).toBe('admin1');
  });

  it('creates a fresh assignment doc for a ref that had none', async () => {
    const fake = newFake();
    fake.seed('levels', SRC, { levelId: SRC, pid: 'bv-brampton-2025-26', teacherRefs: ['mid-c'] });
    fake.seed('levels', TGT, { levelId: TGT, pid: 'bv-brampton-2026-27', teacherRefs: [] });
    // no teacherAssignments/mid-c seeded

    await prefillTeachers(fake.db, ARGS);

    const c = fake.read('teacherAssignments', 'mid-c');
    expect(c!['levelIds']).toEqual([TGT]);
    expect(fake.read('levels', TGT)!['teacherRefs']).toEqual(['mid-c']);
  });

  it('is idempotent — a re-run neither re-fills nor duplicates levelIds', async () => {
    const fake = newFake();
    fake.seed('levels', SRC, {
      levelId: SRC,
      pid: 'bv-brampton-2025-26',
      teacherRefs: ['mid-a', 'mid-b'],
    });
    fake.seed('levels', TGT, { levelId: TGT, pid: 'bv-brampton-2026-27', teacherRefs: [] });
    fake.seed('teacherAssignments', 'mid-a', { ref: 'mid-a', levelIds: [SRC] });
    fake.seed('teacherAssignments', 'mid-b', { ref: 'mid-b', levelIds: [SRC] });

    await prefillTeachers(fake.db, ARGS);
    const second = await prefillTeachers(fake.db, ARGS);

    // second run finds the target already populated → skipped, no write
    expect(second.filled).toEqual([]);
    expect(second.skipped).toEqual([TGT]);

    expect(fake.read('levels', TGT)!['teacherRefs']).toEqual(['mid-a', 'mid-b']);
    expect(fake.read('teacherAssignments', 'mid-a')!['levelIds']).toEqual([SRC, TGT]);
    expect(fake.read('teacherAssignments', 'mid-b')!['levelIds']).toEqual([SRC, TGT]);
  });

  it('never clobbers a target that already has teacherRefs, leaving assignments untouched', async () => {
    const fake = newFake();
    fake.seed('levels', SRC, {
      levelId: SRC,
      pid: 'bv-brampton-2025-26',
      teacherRefs: ['mid-a', 'mid-b'],
    });
    fake.seed('levels', TGT, { levelId: TGT, pid: 'bv-brampton-2026-27', teacherRefs: ['x'] });
    fake.seed('teacherAssignments', 'mid-a', { ref: 'mid-a', levelIds: [SRC] });

    const result = await prefillTeachers(fake.db, ARGS);

    expect(result.filled).toEqual([]);
    expect(result.skipped).toEqual([TGT]);

    // admin assignment survives on the level; the ref's assignment doc is unchanged
    expect(fake.read('levels', TGT)!['teacherRefs']).toEqual(['x']);
    expect(fake.read('levels', TGT)!['updatedBy']).toBeUndefined();
    expect(fake.read('teacherAssignments', 'mid-a')!['levelIds']).toEqual([SRC]);
  });

  it('contributes nothing for a source level with empty teacherRefs', async () => {
    const fake = newFake();
    fake.seed('levels', SRC, { levelId: SRC, pid: 'bv-brampton-2025-26', teacherRefs: [] });
    fake.seed('levels', TGT, { levelId: TGT, pid: 'bv-brampton-2026-27', teacherRefs: [] });

    const result = await prefillTeachers(fake.db, ARGS);

    expect(result.filled).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(fake.read('levels', TGT)!['teacherRefs']).toEqual([]);
    expect(fake.read('levels', TGT)!['updatedBy']).toBeUndefined();
  });

  it('dry-run reports would-fill ids but writes to neither collection', async () => {
    const fake = newFake();
    fake.seed('levels', SRC, {
      levelId: SRC,
      pid: 'bv-brampton-2025-26',
      teacherRefs: ['mid-a', 'mid-b'],
    });
    fake.seed('levels', TGT, { levelId: TGT, pid: 'bv-brampton-2026-27', teacherRefs: [] });
    fake.seed('teacherAssignments', 'mid-a', { ref: 'mid-a', levelIds: [SRC] });

    const result = await prefillTeachers(fake.db, { ...ARGS, dryRun: true });

    expect(result.filled).toEqual([TGT]);
    expect(fake.read('levels', TGT)!['teacherRefs']).toEqual([]); // untouched
    expect(fake.read('levels', TGT)!['updatedBy']).toBeUndefined();
    expect(fake.read('teacherAssignments', 'mid-a')!['levelIds']).toEqual([SRC]); // untouched
  });

  it('skips a source whose next-year twin does not exist', async () => {
    const fake = newFake();
    fake.seed('levels', SRC, { levelId: SRC, pid: 'bv-brampton-2025-26', teacherRefs: ['t1'] });
    // no target seeded

    const result = await prefillTeachers(fake.db, ARGS);

    expect(result.filled).toEqual([]);
    expect(result.skipped).toEqual([TGT]);
  });
});
