import { describe, it, expect, beforeEach, vi } from 'vitest';

// FieldValue.serverTimestamp() must return a recognizable sentinel so the
// in-memory fake can store it without needing a real Firestore.
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__serverTimestamp__' },
}));

import { clonePrasadConfig } from '../clone-prasad-config';

// ── In-memory fake Firestore ────────────────────────────────────────────────
// Backs collection().doc().get()/set()/exists. Only the prasadConfig collection
// is exercised; clonePrasadConfig reads/writes by doc id only (pid == oid).

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

const ARGS = { fromYear: '2025-26', toYear: '2026-27', dryRun: false, actorMid: 'admin1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('clonePrasadConfig', () => {
  it('clones the present source config and skips the missing one', async () => {
    const fake = makeFakeDb();
    // brampton present; scarborough deliberately ABSENT to prove missing sources are skipped.
    fake.seed('prasadConfig', 'bv-brampton-2025-26', {
      pid: 'bv-brampton-2025-26',
      capPerSunday: 12,
    });

    const result = await clonePrasadConfig(fake.db, ARGS);

    expect(result).toEqual({
      fromYear: '2025-26',
      toYear: '2026-27',
      created: ['bv-brampton-2026-27'],
      existing: [],
    });

    const target = fake.read('prasadConfig', 'bv-brampton-2026-27');
    expect(target).toBeDefined();
    expect(target!['pid']).toBe('bv-brampton-2026-27');
    expect(target!['capPerSunday']).toBe(12);
    expect(target!['publishedBy']).toBe('admin1');
    expect(target!['publishedAt']).toBe('__serverTimestamp__');

    // scarborough source missing → no target created.
    expect(fake.read('prasadConfig', 'bv-scarborough-2026-27')).toBeUndefined();
  });

  it('is idempotent — a second run creates 0 and reports the target as existing (no overwrite)', async () => {
    const fake = makeFakeDb();
    fake.seed('prasadConfig', 'bv-brampton-2025-26', {
      pid: 'bv-brampton-2025-26',
      capPerSunday: 12,
    });

    const first = await clonePrasadConfig(fake.db, ARGS);
    expect(first.created).toEqual(['bv-brampton-2026-27']);
    expect(first.existing).toEqual([]);

    // Mutate the cloned target so we can prove a re-run does NOT overwrite it.
    fake.seed('prasadConfig', 'bv-brampton-2026-27', {
      pid: 'bv-brampton-2026-27',
      capPerSunday: 99,
      publishedBy: 'someone-else',
    });

    const second = await clonePrasadConfig(fake.db, ARGS);
    expect(second.created).toEqual([]);
    expect(second.existing).toEqual(['bv-brampton-2026-27']);

    // not overwritten
    const target = fake.read('prasadConfig', 'bv-brampton-2026-27');
    expect(target!['capPerSunday']).toBe(99);
    expect(target!['publishedBy']).toBe('someone-else');

    // total docs = 1 source + 1 cloned (no duplicates)
    expect(fake.size('prasadConfig')).toBe(2);
  });

  it('dry-run reports would-create ids but writes nothing', async () => {
    const fake = makeFakeDb();
    fake.seed('prasadConfig', 'bv-brampton-2025-26', {
      pid: 'bv-brampton-2025-26',
      capPerSunday: 12,
    });

    const result = await clonePrasadConfig(fake.db, { ...ARGS, dryRun: true });

    expect(result.created).toEqual(['bv-brampton-2026-27']);
    expect(fake.size('prasadConfig')).toBe(1); // only the original
    expect(fake.read('prasadConfig', 'bv-brampton-2026-27')).toBeUndefined();
  });
});
