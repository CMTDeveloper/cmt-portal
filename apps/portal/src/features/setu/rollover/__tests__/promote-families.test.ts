import { describe, it, expect, beforeEach, vi } from 'vitest';

// FieldValue.serverTimestamp() must return a recognizable sentinel so the
// in-memory fake can store it without needing a real Firestore.
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__serverTimestamp__' },
}));

import { promoteFamilies } from '../promote-families';

// ── In-memory fake Firestore ────────────────────────────────────────────────
// Supports the surface promoteFamilies needs:
//   - collection('levels' | 'offerings').where(...).get()
//   - collection('families').doc(fid).collection('members' | 'enrollments')
//   - subcollection .doc(id).get()/.set(merge) and a whole-collection .get()
//   - collectionGroup('enrollments').where().where().get()
//   - runTransaction(fn) where txn exposes get(ref)/set(ref,data,opts)
// Subcollection docs live in a flat keyed map so collectionGroup can sweep them.

type DocData = Record<string, unknown>;

// Every document (top-level or subcollection) is keyed by a unique path string.
// Top-level:        `${collection}/${id}`
// Subcollection:    `families/${fid}/${sub}/${id}`
type Store = Map<string, DocData>;

function makeRef(store: Store, path: string, group: string | null) {
  return {
    path,
    // group = the subcollection name (e.g. 'enrollments') for collectionGroup sweeps
    group,
    async get() {
      const data = store.get(path);
      return data
        ? { exists: true, id: lastSegment(path), data: () => data }
        : { exists: false, id: lastSegment(path), data: () => undefined };
    },
    async set(value: DocData, opts?: { merge?: boolean }) {
      const prev = opts?.merge ? store.get(path) : undefined;
      store.set(path, { ...(prev ?? {}), ...value, __id: lastSegment(path), __path: path });
    },
  };
}

function lastSegment(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1]!;
}

class FakeQuery {
  constructor(
    private readonly store: Store,
    private readonly predicate: (path: string, data: DocData) => boolean,
    private readonly filters: Array<[string, string, unknown]>,
  ) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.store, this.predicate, [...this.filters, [field, op, value]]);
  }

  async get() {
    const docs = [...this.store.entries()]
      .filter(([path, data]) => this.predicate(path, data))
      .filter(([, data]) => this.filters.every(([field, , value]) => data[field] === value))
      .map(([path, data]) => ({ id: lastSegment(path), data: () => data, ref: makeRef(this.store, path, null) }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class FakeCollection {
  // prefix is the full path up to (and including) this collection name.
  constructor(private readonly store: Store, private readonly prefix: string) {}

  doc(id: string) {
    const path = `${this.prefix}/${id}`;
    const group = this.prefix.split('/').pop() ?? null;
    const ref = makeRef(this.store, path, group);
    return {
      ...ref,
      collection: (sub: string) => new FakeCollection(this.store, `${path}/${sub}`),
    };
  }

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(
      this.store,
      (path) => isDirectChildOf(path, this.prefix),
      [[field, op, value]],
    );
  }

  // whole-collection read (used for families/{fid}/members)
  async get() {
    const docs = [...this.store.entries()]
      .filter(([path]) => isDirectChildOf(path, this.prefix))
      .map(([path, data]) => ({ id: lastSegment(path), data: () => data, ref: makeRef(this.store, path, null) }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

/** True when `path` is exactly one segment deeper than `prefix`. */
function isDirectChildOf(path: string, prefix: string): boolean {
  if (!path.startsWith(`${prefix}/`)) return false;
  const rest = path.slice(prefix.length + 1);
  return !rest.includes('/');
}

function makeFakeDb() {
  const store: Store = new Map();
  const db = {
    collection: (name: string) => new FakeCollection(store, name),
    collectionGroup: (name: string) =>
      new FakeQuery(store, (path) => collectionGroupMatch(path, name), []),
    runTransaction: async <T>(fn: (txn: FakeTxn) => Promise<T>): Promise<T> => {
      // Minimal transaction: no isolation needed for these unit tests. The txn
      // delegates synchronously to the same in-memory store. Reads see prior
      // writes within the same txn (sufficient for our read-then-write path).
      const txn: FakeTxn = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => {
          void ref.set(data, opts);
        },
        update: (ref, data) => {
          void ref.set(data, { merge: true });
        },
      };
      return fn(txn);
    },
  } as unknown as FirebaseFirestore.Firestore;

  // Seed a top-level doc (offerings / levels).
  const seed = (collection: string, id: string, data: DocData) => {
    const path = `${collection}/${id}`;
    store.set(path, { ...data, __id: id, __path: path });
  };
  // Seed a families subcollection doc (members / enrollments).
  const seedSub = (fid: string, sub: string, id: string, data: DocData) => {
    const path = `families/${fid}/${sub}/${id}`;
    store.set(path, { ...data, __id: id, __path: path });
  };
  const read = (collection: string, id: string) => store.get(`${collection}/${id}`);
  const readSub = (fid: string, sub: string, id: string) =>
    store.get(`families/${fid}/${sub}/${id}`);
  return { db, seed, seedSub, read, readSub };
}

interface FakeRef {
  get(): Promise<{ exists: boolean; id: string; data: () => DocData | undefined }>;
  set(data: DocData, opts?: { merge?: boolean }): Promise<void>;
}
interface FakeTxn {
  get(ref: FakeRef): Promise<{ exists: boolean; id: string; data: () => DocData | undefined }>;
  set(ref: FakeRef, data: DocData, opts?: { merge?: boolean }): void;
  update(ref: FakeRef, data: DocData): void;
}

/** A collectionGroup('enrollments') sweep matches any `.../enrollments/{id}` doc. */
function collectionGroupMatch(path: string, group: string): boolean {
  const parts = path.split('/');
  // need at least `<col>/<id>/<group>/<id>`
  return parts.length >= 4 && parts[parts.length - 2] === group;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function seedLevels(fake: ReturnType<typeof makeFakeDb>) {
  // 2025-26 source levels (Brampton)
  fake.seed('levels', 'brampton-level-2-bv-brampton-2025-26', {
    levelId: 'brampton-level-2-bv-brampton-2025-26',
    levelName: 'Level 2',
    levelKind: 'level',
    gradeBand: ['2', '3'],
    pid: 'bv-brampton-2025-26',
    location: 'Brampton',
  });
  fake.seed('levels', 'brampton-level-3-bv-brampton-2025-26', {
    levelId: 'brampton-level-3-bv-brampton-2025-26',
    levelName: 'Level 3',
    levelKind: 'level',
    gradeBand: ['4', '5'],
    pid: 'bv-brampton-2025-26',
    location: 'Brampton',
  });
  // 2026-27 target levels (Brampton)
  fake.seed('levels', 'brampton-level-2-bv-brampton-2026-27', {
    levelId: 'brampton-level-2-bv-brampton-2026-27',
    levelName: 'Level 2',
    levelKind: 'level',
    gradeBand: ['2', '3'],
    pid: 'bv-brampton-2026-27',
    location: 'Brampton',
  });
  fake.seed('levels', 'brampton-level-3-bv-brampton-2026-27', {
    levelId: 'brampton-level-3-bv-brampton-2026-27',
    levelName: 'Level 3',
    levelKind: 'level',
    gradeBand: ['4', '5'],
    pid: 'bv-brampton-2026-27',
    location: 'Brampton',
  });
}

function seedTargetOffering(fake: ReturnType<typeof makeFakeDb>) {
  fake.seed('offerings', 'bv-brampton-2026-27', {
    oid: 'bv-brampton-2026-27',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    location: 'Brampton',
    termLabel: '2026-27',
    pricingTiers: [],
    enabled: true,
  });
}

function seedFamily(fake: ReturnType<typeof makeFakeDb>, fid: string, children: Array<{ mid: string; grade: string; first: string }>) {
  for (const c of children) {
    fake.seedSub(fid, 'members', c.mid, {
      mid: c.mid,
      firstName: c.first,
      lastName: 'R',
      type: 'Child',
      schoolGrade: c.grade,
      birthMonthYear: null,
    });
  }
  const eid = `${fid}-bv-brampton-2025-26`;
  fake.seedSub(fid, 'enrollments', eid, {
    eid,
    fid,
    oid: 'bv-brampton-2025-26',
    pid: 'bv-brampton-2025-26',
    status: 'active',
    enrolledMids: children.map((c) => c.mid),
    location: 'Brampton',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    termLabel: '2025-26',
  });
}

const ARGS = { fromYear: '2025-26', toYear: '2026-27', actorMid: 'A1', dryRun: false };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('promoteFamilies', () => {
  it('advances grades, closes the source enrollment with history, and creates the target enrollment', async () => {
    const fake = makeFakeDb();
    seedLevels(fake);
    seedTargetOffering(fake);
    seedFamily(fake, 'F1', [
      { mid: 'F1-02', grade: '2', first: 'A' },
      { mid: 'F1-03', grade: '3', first: 'B' },
    ]);

    const report = await promoteFamilies(fake.db, ARGS);

    // ── members advanced ──
    expect(fake.readSub('F1', 'members', 'F1-02')!['schoolGrade']).toBe('3');
    expect(fake.readSub('F1', 'members', 'F1-03')!['schoolGrade']).toBe('4');

    // ── source enrollment closed with OLD-year snapshots ──
    const src = fake.readSub('F1', 'enrollments', 'F1-bv-brampton-2025-26')!;
    expect(src['status']).toBe('cancelled');
    expect(src['cancelledReason']).toBe('promoted-2026-27');
    const srcSnaps = src['levelSnapshots'] as Record<string, { levelName: string | null }>;
    // both children sat in Level 2 in 2025-26 (Gr2 and Gr3 both ∈ band ['2','3'])
    expect(srcSnaps['F1-02']!.levelName).toBe('Level 2');
    expect(srcSnaps['F1-03']!.levelName).toBe('Level 2');

    // ── target enrollment created ──
    const tgt = fake.readSub('F1', 'enrollments', 'F1-bv-brampton-2026-27')!;
    expect(tgt['status']).toBe('active');
    expect(tgt['pid']).toBe('bv-brampton-2026-27');
    expect(tgt['oid']).toBe('bv-brampton-2026-27');
    expect(tgt['enrolledVia']).toBe('promotion');
    expect(tgt['enrolledMids']).toEqual(['F1-02', 'F1-03']);
    const tgtSnaps = tgt['levelSnapshots'] as Record<string, { levelName: string | null }>;
    expect(tgtSnaps['F1-02']!.levelName).toBe('Level 2'); // Gr3 → still Level 2
    expect(tgtSnaps['F1-03']!.levelName).toBe('Level 3'); // Gr4 → Level 3

    // ── report ──
    expect(report.promoted).toBe(2);
    expect(report.advanced).toBe(2);
    expect(report.graduated).toBe(0);
    expect(report.needsAttention).toBe(0);
    expect(report.familiesProcessed).toBe(1);
    expect(report.fromYear).toBe('2025-26');
    expect(report.toYear).toBe('2026-27');
    expect(report.dryRun).toBe(false);
    expect(report.byTransition).toContainEqual({ label: 'Level 2 → Level 2', count: 1 });
    expect(report.byTransition).toContainEqual({ label: 'Level 2 → Level 3', count: 1 });
  });

  it('is idempotent: a plain second run does not re-discover or double-advance', async () => {
    const fake = makeFakeDb();
    seedLevels(fake);
    seedTargetOffering(fake);
    seedFamily(fake, 'F1', [
      { mid: 'F1-02', grade: '2', first: 'A' },
      { mid: 'F1-03', grade: '3', first: 'B' },
    ]);

    await promoteFamilies(fake.db, ARGS);
    // After commit the source is cancelled atomically with the target create, so a
    // re-run finds NO active source enrollments → nothing to advance (idempotent).
    const report2 = await promoteFamilies(fake.db, ARGS);

    expect(report2.familiesProcessed).toBe(0);
    expect(report2.promoted).toBe(0);
    expect(report2.advanced).toBe(0);
    // grades unchanged from the first run (NOT advanced to '4'/'5')
    expect(fake.readSub('F1', 'members', 'F1-02')!['schoolGrade']).toBe('3');
    expect(fake.readSub('F1', 'members', 'F1-03')!['schoolGrade']).toBe('4');
  });

  it('skips a family whose target enrollment is already active (re-entry / partial-run gate)', async () => {
    const fake = makeFakeDb();
    seedLevels(fake);
    seedTargetOffering(fake);
    seedFamily(fake, 'F1', [
      { mid: 'F1-02', grade: '2', first: 'A' },
      { mid: 'F1-03', grade: '3', first: 'B' },
    ]);
    // Simulate a partial prior run: the source is STILL active (so it is
    // re-discovered) but a target enrollment already exists active. The per-family
    // gate must skip this family — never double-advancing grades.
    fake.seedSub('F1', 'enrollments', 'F1-bv-brampton-2026-27', {
      eid: 'F1-bv-brampton-2026-27',
      fid: 'F1',
      oid: 'bv-brampton-2026-27',
      pid: 'bv-brampton-2026-27',
      status: 'active',
      enrolledMids: ['F1-02', 'F1-03'],
    });

    const report = await promoteFamilies(fake.db, ARGS);

    expect(report.familiesSkippedAlreadyPromoted).toBe(1);
    expect(report.familiesProcessed).toBe(0);
    expect(report.promoted).toBe(0);
    // grades untouched, source still active (gate fired before any write)
    expect(fake.readSub('F1', 'members', 'F1-02')!['schoolGrade']).toBe('2');
    expect(fake.readSub('F1', 'members', 'F1-03')!['schoolGrade']).toBe('3');
    expect(fake.readSub('F1', 'enrollments', 'F1-bv-brampton-2025-26')!['status']).toBe('active');
  });

  it('dry-run reports counts but writes nothing', async () => {
    const fake = makeFakeDb();
    seedLevels(fake);
    seedTargetOffering(fake);
    seedFamily(fake, 'F2', [{ mid: 'F2-02', grade: '2', first: 'C' }]);

    const report = await promoteFamilies(fake.db, { ...ARGS, dryRun: true });

    // counts reflect F2
    expect(report.dryRun).toBe(true);
    expect(report.promoted).toBe(1);
    expect(report.advanced).toBe(1);

    // nothing written: source still active, no target enrollment, grade unchanged
    const src = fake.readSub('F2', 'enrollments', 'F2-bv-brampton-2025-26')!;
    expect(src['status']).toBe('active');
    expect(fake.readSub('F2', 'enrollments', 'F2-bv-brampton-2026-27')).toBeUndefined();
    expect(fake.readSub('F2', 'members', 'F2-02')!['schoolGrade']).toBe('2');
  });
});
