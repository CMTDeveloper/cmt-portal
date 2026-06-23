import { describe, it, expect, beforeEach, vi } from 'vitest';

// FieldValue.serverTimestamp() must return a recognizable sentinel so the
// in-memory fake can store it without needing a real Firestore.
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__serverTimestamp__' },
}));

import { cloneCalendarYear } from '../clone-calendar';

// ── In-memory fake Firestore ────────────────────────────────────────────────
// Backs collection().doc().get()/set()/exists and a chained
// collection().where().where().where().get(). Unlike start-new-year's fake,
// this one must support range ops (>=, <=) on the lexical YYYY-MM-DD `date`
// field, so the filter handles '==', '>=' and '<=' (string compare is correct
// for fixed-width ISO dates).

type DocData = Record<string, unknown>;

function passesFilter(data: DocData, field: string, op: string, value: unknown): boolean {
  const actual = data[field];
  switch (op) {
    case '==':
      return actual === value;
    case '>=':
      return String(actual) >= String(value);
    case '<=':
      return String(actual) <= String(value);
    default:
      throw new Error(`unsupported op in fake: ${op}`);
  }
}

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
      .filter((data) => this.filters.every(([field, op, value]) => passesFilter(data, field, op, value)))
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
  const seed = (collection: string, id: string, data: DocData) => {
    storeFor(collection).set(id, { ...data, __id: id });
  };
  const read = (collection: string, id: string) => storeFor(collection).get(id);
  const size = (collection: string) => storeFor(collection).size;
  return { db, seed, read, size };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function plus364(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 364);
  return dt.toISOString().slice(0, 10);
}

function utcWeekday(d: string): number {
  return new Date(`${d}T00:00:00Z`).getUTCDay();
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// Two BV source class Sundays in the 2025-26 window. Both are Sundays.

const SOURCE_A_DATE = '2025-09-07'; // Sunday
const SOURCE_B_DATE = '2025-12-21'; // Sunday

function sourceEntry(date: string): DocData {
  return {
    entryId: `bala-vihar-brampton-${date}`,
    programKey: 'bala-vihar',
    location: 'Brampton',
    date,
    kind: 'class',
    classType: 'regular',
    noClassReason: null,
    specialEvents: null,
    enabled: true,
    prasadNeeded: true,
    createdBy: 'u1',
    updatedBy: 'u1',
  };
}

function seedSource(fake: ReturnType<typeof makeFakeDb>) {
  const a = sourceEntry(SOURCE_A_DATE);
  const b = sourceEntry(SOURCE_B_DATE);
  fake.seed('classCalendarEntries', String(a['entryId']), a);
  fake.seed('classCalendarEntries', String(b['entryId']), b);
}

const ARGS = { fromYear: '2025-26', toYear: '2026-27', dryRun: false };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cloneCalendarYear', () => {
  it('asserts both source dates are Sundays (fixture sanity)', () => {
    expect(utcWeekday(SOURCE_A_DATE)).toBe(0);
    expect(utcWeekday(SOURCE_B_DATE)).toBe(0);
  });

  it('clones both source entries shifted +364 days and reports created ids', async () => {
    const fake = makeFakeDb();
    seedSource(fake);

    const result = await cloneCalendarYear(fake.db, ARGS);

    expect(result.created).toHaveLength(2);
    expect(result.existing).toHaveLength(0);
    expect(result.fromYear).toBe('2025-26');
    expect(result.toYear).toBe('2026-27');

    const newDateA = plus364(SOURCE_A_DATE);
    const targetIdA = `bala-vihar-brampton-${newDateA}`;
    expect(result.created).toContain(targetIdA);

    const targetA = fake.read('classCalendarEntries', targetIdA);
    expect(targetA).toBeDefined();
    expect(targetA!['date']).toBe(newDateA);
    expect(targetA!['entryId']).toBe(targetIdA);
    // a class Sunday stays a Sunday
    expect(utcWeekday(newDateA)).toBe(0);
  });

  it('builds a full valid doc carrying source fields + a fresh actor-less timestamp', async () => {
    const fake = makeFakeDb();
    seedSource(fake);

    await cloneCalendarYear(fake.db, ARGS);

    const newDateA = plus364(SOURCE_A_DATE);
    const target = fake.read('classCalendarEntries', `bala-vihar-brampton-${newDateA}`);
    expect(target!['programKey']).toBe('bala-vihar');
    expect(target!['location']).toBe('Brampton');
    expect(target!['kind']).toBe('class');
    expect(target!['classType']).toBe('regular');
    expect(target!['noClassReason']).toBeNull();
    expect(target!['specialEvents']).toBeNull();
    expect(target!['enabled']).toBe(true);
    expect(target!['prasadNeeded']).toBe(true);
    // carries source actor faithfully
    expect(target!['createdBy']).toBe('u1');
    expect(target!['updatedBy']).toBe('u1');
    // fresh server timestamp sentinel
    expect(target!['createdAt']).toBe('__serverTimestamp__');
    expect(target!['updatedAt']).toBe('__serverTimestamp__');
  });

  it('is idempotent — a second run creates 0 and reports both as existing', async () => {
    const fake = makeFakeDb();
    seedSource(fake);

    const first = await cloneCalendarYear(fake.db, ARGS);
    expect(first.created).toHaveLength(2);

    const second = await cloneCalendarYear(fake.db, ARGS);
    expect(second.created).toHaveLength(0);
    expect(second.existing).toHaveLength(2);

    // total docs = 2 source + 2 cloned (no duplicates)
    expect(fake.size('classCalendarEntries')).toBe(4);
  });

  it('dry-run reports would-create ids but writes nothing', async () => {
    const fake = makeFakeDb();
    seedSource(fake);

    const result = await cloneCalendarYear(fake.db, { ...ARGS, dryRun: true });

    expect(result.created).toHaveLength(2);
    expect(fake.size('classCalendarEntries')).toBe(2); // only the originals
  });
});
