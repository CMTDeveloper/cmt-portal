import { describe, it, expect, beforeEach, vi } from 'vitest';

// FieldValue.serverTimestamp() must return a recognizable sentinel so the
// in-memory fake can store it without needing a real Firestore.
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__serverTimestamp__' },
}));

import { startNewYear } from '../start-new-year';

// ── In-memory fake Firestore ────────────────────────────────────────────────
// Backs collection().doc().get()/set(), doc().exists, and a chained
// collection().where().where().get(). Dates are stored raw (the engine's
// toDate() helper handles both Date and {toDate()} shapes).

type DocData = Record<string, unknown>;

class FakeQuery {
  constructor(
    private readonly store: Map<string, DocData>,
    private readonly filters: Array<[string, string, unknown]>,
  ) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.store, [...this.filters, [field, op, value]]);
  }

  async get() {
    const docs = [...this.store.values()]
      .filter((data) => this.filters.every(([field, , value]) => data[field] === value))
      .map((data) => ({ id: String(data['__id']), data: () => data }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
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
      set: async (value: DocData) => {
        this.store.set(id, { ...value, __id: id });
      },
    };
  }

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.store, [[field, op, value]]);
  }
}

function makeFakeDb() {
  const collections: Record<string, Map<string, DocData>> = {};
  const storeFor = (name: string) => (collections[name] ??= new Map<string, DocData>());
  const db = {
    collection: (name: string) => new FakeCollection(storeFor(name)),
  } as unknown as FirebaseFirestore.Firestore;
  // Test helper to seed + read raw docs.
  const seed = (collection: string, id: string, data: DocData) => {
    storeFor(collection).set(id, { ...data, __id: id });
  };
  const read = (collection: string, id: string) => storeFor(collection).get(id);
  return { db, seed, read };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const SOURCE_OFFERING = {
  oid: 'bv-brampton-2025-26',
  programKey: 'bala-vihar',
  programLabel: 'Bala Vihar',
  location: 'Brampton',
  termLabel: '2025-26',
  termType: 'term',
  startDate: new Date('2025-09-01T00:00:00Z'),
  endDate: new Date('2026-06-30T00:00:00Z'),
  pricingTiers: [],
  paymentSource: 'legacy',
  enabled: true,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  createdBy: 'seed-script',
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  updatedBy: 'seed-script',
};

const SOURCE_LEVEL_1 = {
  levelId: 'brampton-level-1-bv-brampton-2025-26',
  programKey: 'bala-vihar',
  location: 'Brampton',
  levelName: 'Level 1',
  levelKind: 'level',
  order: 2,
  gradeBand: ['1'],
  ageLabel: 'Grade 1',
  curriculum: 'Krishna',
  pid: 'bv-brampton-2025-26',
  periodLabel: '2025-26',
  teacherRefs: ['Tx'],
  enabled: true,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  createdBy: 'seed-script',
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  updatedBy: 'seed-script',
};

const SOURCE_LEVEL_SHISHU = {
  levelId: 'brampton-shishu-vihar-bv-brampton-2025-26',
  programKey: 'bala-vihar',
  location: 'Brampton',
  levelName: 'Shishu Vihar',
  levelKind: 'shishu',
  order: 0,
  gradeBand: [],
  ageLabel: '1.5 to 4 years',
  curriculum: 'Devatas',
  pid: 'bv-brampton-2025-26',
  periodLabel: '2025-26',
  teacherRefs: [],
  enabled: true,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  createdBy: 'seed-script',
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  updatedBy: 'seed-script',
};

function seedSource(fake: ReturnType<typeof makeFakeDb>) {
  fake.seed('offerings', SOURCE_OFFERING.oid, { ...SOURCE_OFFERING });
  fake.seed('levels', SOURCE_LEVEL_1.levelId, { ...SOURCE_LEVEL_1 });
  fake.seed('levels', SOURCE_LEVEL_SHISHU.levelId, { ...SOURCE_LEVEL_SHISHU });
}

const ARGS = { fromYear: '2025-26', toYear: '2026-27', actorMid: 'A1', dryRun: false };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('startNewYear', () => {
  it('clones the source offering into the target year', async () => {
    const fake = makeFakeDb();
    seedSource(fake);

    const result = await startNewYear(fake.db, ARGS);

    const target = fake.read('offerings', 'bv-brampton-2026-27');
    expect(target).toBeDefined();
    expect(target!['termLabel']).toBe('2026-27');
    expect(target!['paymentSource']).toBe('portal');
    expect(target!['enabled']).toBe(true);
    expect(target!['programKey']).toBe('bala-vihar');
    expect(target!['createdBy']).toBe('A1');
    expect(result.offeringsCreated).toContain('bv-brampton-2026-27');
  });

  it('clones the source levels into the target year with reset teacherRefs', async () => {
    const fake = makeFakeDb();
    seedSource(fake);

    const result = await startNewYear(fake.db, ARGS);

    const level = fake.read('levels', 'brampton-level-1-bv-brampton-2026-27');
    expect(level).toBeDefined();
    expect(level!['pid']).toBe('bv-brampton-2026-27');
    expect(level!['periodLabel']).toBe('2026-27');
    expect(level!['gradeBand']).toEqual(['1']);
    expect(level!['teacherRefs']).toEqual([]);
    expect(level!['createdBy']).toBe('A1');
    expect(result.levelsCreated).toContain('brampton-level-1-bv-brampton-2026-27');

    // shishu level cloned too
    const shishu = fake.read('levels', 'brampton-shishu-vihar-bv-brampton-2026-27');
    expect(shishu).toBeDefined();
    expect(shishu!['levelKind']).toBe('shishu');
    expect(result.levelsCreated).toContain('brampton-shishu-vihar-bv-brampton-2026-27');
  });

  it('ensures a donationPeriods mirror for the target offering', async () => {
    const fake = makeFakeDb();
    seedSource(fake);

    const result = await startNewYear(fake.db, ARGS);

    const dp = fake.read('donationPeriods', 'bv-brampton-2026-27');
    expect(dp).toBeDefined();
    expect(dp!['pid']).toBe('bv-brampton-2026-27');
    expect(dp!['periodLabel']).toBe('2026-27');
    expect(dp!['paymentSource']).toBe('portal');
    expect(result.donationPeriodsCreated).toContain('bv-brampton-2026-27');
  });

  it('is idempotent and preserves an admin-assigned teacherRefs on an existing target level', async () => {
    const fake = makeFakeDb();
    seedSource(fake);
    // Admin already created the target level and assigned a teacher.
    fake.seed('levels', 'brampton-level-1-bv-brampton-2026-27', {
      ...SOURCE_LEVEL_1,
      levelId: 'brampton-level-1-bv-brampton-2026-27',
      pid: 'bv-brampton-2026-27',
      periodLabel: '2026-27',
      teacherRefs: ['T9'],
    });

    const result = await startNewYear(fake.db, ARGS);

    const level = fake.read('levels', 'brampton-level-1-bv-brampton-2026-27');
    expect(level!['teacherRefs']).toEqual(['T9']); // NOT overwritten
    expect(result.levelsExisting).toContain('brampton-level-1-bv-brampton-2026-27');
    expect(result.levelsCreated).not.toContain('brampton-level-1-bv-brampton-2026-27');
  });

  it('reports an already-created target offering as existing, not created', async () => {
    const fake = makeFakeDb();
    seedSource(fake);
    fake.seed('offerings', 'bv-brampton-2026-27', {
      ...SOURCE_OFFERING,
      oid: 'bv-brampton-2026-27',
      termLabel: '2026-27',
      paymentSource: 'portal',
    });

    const result = await startNewYear(fake.db, ARGS);

    expect(result.offeringsExisting).toContain('bv-brampton-2026-27');
    expect(result.offeringsCreated).not.toContain('bv-brampton-2026-27');
  });

  it('dry-run reports would-create ids but writes nothing', async () => {
    const fake = makeFakeDb();
    seedSource(fake);

    const result = await startNewYear(fake.db, { ...ARGS, dryRun: true });

    expect(result.offeringsCreated).toContain('bv-brampton-2026-27');
    expect(result.levelsCreated).toContain('brampton-level-1-bv-brampton-2026-27');
    expect(result.donationPeriodsCreated).toContain('bv-brampton-2026-27');

    // Nothing was actually written.
    expect(fake.read('offerings', 'bv-brampton-2026-27')).toBeUndefined();
    expect(fake.read('levels', 'brampton-level-1-bv-brampton-2026-27')).toBeUndefined();
    expect(fake.read('donationPeriods', 'bv-brampton-2026-27')).toBeUndefined();
  });

  it('shifts offering start/end dates forward by one year', async () => {
    const fake = makeFakeDb();
    seedSource(fake);

    await startNewYear(fake.db, ARGS);

    const target = fake.read('offerings', 'bv-brampton-2026-27');
    const start = target!['startDate'] as Date;
    const end = target!['endDate'] as Date;
    expect(start.getUTCFullYear()).toBe(2026);
    expect(start.getUTCMonth()).toBe(8); // September (0-indexed)
    expect(start.getUTCDate()).toBe(1);
    expect(end.getUTCFullYear()).toBe(2027);
    expect(end.getUTCMonth()).toBe(5); // June
    expect(end.getUTCDate()).toBe(30);
  });

  it('returns fromYear/toYear in the result', async () => {
    const fake = makeFakeDb();
    seedSource(fake);

    const result = await startNewYear(fake.db, ARGS);
    expect(result.fromYear).toBe('2025-26');
    expect(result.toYear).toBe('2026-27');
  });
});
