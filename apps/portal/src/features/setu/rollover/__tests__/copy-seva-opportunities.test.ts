import { describe, it, expect, beforeEach, vi } from 'vitest';

// FieldValue.serverTimestamp() must return a recognizable sentinel so the
// in-memory fake can store it without needing a real Firestore.
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__serverTimestamp__' },
}));

import { copySevaOpportunities } from '../copy-seva-opportunities';

// ── In-memory fake Firestore ────────────────────────────────────────────────
// Backs collection().doc().get()/set()/exists. copySevaOpportunities reads and
// writes by doc id only, so a doc-keyed fake is sufficient (no where/orderBy).
// `date` is seeded as a JS Date; the engine's `.toDate?.() ?? new Date(...)`
// branch handles a plain Date (no Timestamp shape).

type DocData = Record<string, unknown>;

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

// A realistic source opp doc (mirrors docToOpportunity's read shape).
const srcOpp = (over: DocData = {}): DocData => ({
  oppId: 'opp-a',
  title: 'Kitchen setup',
  description: 'Help set up the kitchen',
  date: new Date(Date.UTC(2025, 10, 9)), // 2025-11-09 (Sunday)
  location: 'Brampton kitchen',
  defaultHours: 4,
  capacity: 10,
  sevaYear: '2025-26',
  status: 'open',
  createdAt: new Date(),
  createdBy: 'u',
  updatedAt: new Date(),
  updatedBy: 'u',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('copySevaOpportunities', () => {
  it('copies a selected opp shifting date +364d (Sunday→Sunday), status open, into the target year', async () => {
    const fake = makeFakeDb();
    fake.seed('seva_opportunities', 'opp-a', srcOpp());

    const result = await copySevaOpportunities(fake.db, {
      fromYear: '2025-26',
      toYear: '2026-27',
      oppIds: ['opp-a'],
      decideLater: false,
      actorMid: 'admin1',
    });

    expect(result).toEqual({
      fromYear: '2025-26',
      toYear: '2026-27',
      created: ['opp-a-2026-27'],
      existing: [],
    });

    const target = fake.read('seva_opportunities', 'opp-a-2026-27');
    expect(target).toBeDefined();
    expect(target!['oppId']).toBe('opp-a-2026-27');
    expect(target!['title']).toBe('Kitchen setup');
    expect(target!['description']).toBe('Help set up the kitchen');
    expect(target!['location']).toBe('Brampton kitchen');
    expect(target!['defaultHours']).toBe(4);
    expect(target!['capacity']).toBe(10);
    expect(target!['sevaYear']).toBe('2026-27');
    expect(target!['status']).toBe('open');
    expect(target!['createdBy']).toBe('admin1');
    expect(target!['updatedBy']).toBe('admin1');
    expect(target!['createdAt']).toBe('__serverTimestamp__');
    expect(target!['updatedAt']).toBe('__serverTimestamp__');

    // +364 days of 2025-11-09 (Sun) is 2025-11-08 of next year — still a Sunday.
    const targetDate = target!['date'] as Date;
    expect(targetDate).toBeInstanceOf(Date);
    // 2026-11-08 (months are 0-indexed → 10)
    expect(targetDate.getUTCFullYear()).toBe(2026);
    expect(targetDate.getUTCMonth()).toBe(10);
    expect(targetDate.getUTCDate()).toBe(8);
    expect(targetDate.getUTCDay()).toBe(0); // Sunday
  });

  it('copies with decideLater → status draft, keeping the +364d placeholder date', async () => {
    const fake = makeFakeDb();
    fake.seed(
      'seva_opportunities',
      'opp-b',
      srcOpp({
        oppId: 'opp-b',
        title: 'Cleanup crew',
        date: new Date(Date.UTC(2025, 11, 7)), // 2025-12-07 (Sunday)
      }),
    );

    const result = await copySevaOpportunities(fake.db, {
      fromYear: '2025-26',
      toYear: '2026-27',
      oppIds: ['opp-b'],
      decideLater: true,
      actorMid: 'admin1',
    });

    expect(result.created).toEqual(['opp-b-2026-27']);

    const target = fake.read('seva_opportunities', 'opp-b-2026-27');
    expect(target!['status']).toBe('draft');
    // +364 days of 2025-12-07 → 2026-12-06 (still a Sunday placeholder)
    const targetDate = target!['date'] as Date;
    expect(targetDate.getUTCFullYear()).toBe(2026);
    expect(targetDate.getUTCMonth()).toBe(11);
    expect(targetDate.getUTCDate()).toBe(6);
    expect(targetDate.getUTCDay()).toBe(0);
  });

  it('skips an oppId whose source sevaYear !== fromYear', async () => {
    const fake = makeFakeDb();
    // Source belongs to a DIFFERENT year — must not be copied.
    fake.seed('seva_opportunities', 'opp-old', srcOpp({ oppId: 'opp-old', sevaYear: '2024-25' }));

    const result = await copySevaOpportunities(fake.db, {
      fromYear: '2025-26',
      toYear: '2026-27',
      oppIds: ['opp-old'],
      decideLater: false,
      actorMid: 'admin1',
    });

    expect(result.created).toEqual([]);
    expect(result.existing).toEqual([]);
    expect(fake.read('seva_opportunities', 'opp-old-2026-27')).toBeUndefined();
  });

  it('skips an oppId that does not exist', async () => {
    const fake = makeFakeDb();
    const result = await copySevaOpportunities(fake.db, {
      fromYear: '2025-26',
      toYear: '2026-27',
      oppIds: ['ghost'],
      decideLater: false,
      actorMid: 'admin1',
    });
    expect(result.created).toEqual([]);
    expect(result.existing).toEqual([]);
  });

  it('is idempotent — a second run reports the target as existing and does NOT overwrite', async () => {
    const fake = makeFakeDb();
    fake.seed('seva_opportunities', 'opp-a', srcOpp());

    const first = await copySevaOpportunities(fake.db, {
      fromYear: '2025-26',
      toYear: '2026-27',
      oppIds: ['opp-a'],
      decideLater: false,
      actorMid: 'admin1',
    });
    expect(first.created).toEqual(['opp-a-2026-27']);
    expect(first.existing).toEqual([]);

    // Mutate the cloned target so we can prove a re-run does NOT overwrite it.
    fake.seed('seva_opportunities', 'opp-a-2026-27', {
      oppId: 'opp-a-2026-27',
      title: 'edited by an admin',
      sevaYear: '2026-27',
      status: 'open',
    });

    const second = await copySevaOpportunities(fake.db, {
      fromYear: '2025-26',
      toYear: '2026-27',
      oppIds: ['opp-a'],
      decideLater: false,
      actorMid: 'admin1',
    });
    expect(second.created).toEqual([]);
    expect(second.existing).toEqual(['opp-a-2026-27']);

    // not overwritten
    const target = fake.read('seva_opportunities', 'opp-a-2026-27');
    expect(target!['title']).toBe('edited by an admin');

    // total docs = 1 source + 1 cloned (no duplicates)
    expect(fake.size('seva_opportunities')).toBe(2);
  });

  it('copies multiple oppIds in one call', async () => {
    const fake = makeFakeDb();
    fake.seed('seva_opportunities', 'opp-a', srcOpp());
    fake.seed(
      'seva_opportunities',
      'opp-b',
      srcOpp({ oppId: 'opp-b', date: new Date(Date.UTC(2025, 11, 7)) }),
    );

    const result = await copySevaOpportunities(fake.db, {
      fromYear: '2025-26',
      toYear: '2026-27',
      oppIds: ['opp-a', 'opp-b'],
      decideLater: false,
      actorMid: 'admin1',
    });

    expect(result.created).toEqual(['opp-a-2026-27', 'opp-b-2026-27']);
  });
});
