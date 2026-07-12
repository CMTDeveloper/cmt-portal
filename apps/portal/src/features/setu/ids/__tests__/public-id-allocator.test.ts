import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Stateful fake Firestore harness ───────────────────────────────────────────
// Mirrors the mock style of
// features/setu/registration/__tests__/register-family.test.ts
// (vi.hoisted + vi.mock('@cmt/firebase-shared/admin/firestore') exposing
// portalFirestore().runTransaction with a txn.get/txn.set shape), but keeps an
// in-memory `counters` store so allocations persist + increment ACROSS calls
// within a single test — the allocator opens its OWN runTransaction each call,
// so the second call must observe the first call's write.
const { store, legacyIds, mockPortalFirestore } = vi.hoisted(() => {
  // path "counters/{name}" -> { next: number }
  const store = new Map<string, { next: number }>();
  // The set of family legacy check-in ids present in the DB (the allocator skips
  // a candidate that equals one of these).
  const legacyIds = new Set<string>();
  // One stable docRef per path so reads/writes across calls share the store.
  const refs = new Map<string, ReturnType<typeof makeDocRef>>();

  function makeDocRef(path: string) {
    return {
      get: async () => {
        const data = store.get(path);
        return { exists: data !== undefined, data: () => data };
      },
      set: (value: { next: number }, options?: { merge?: boolean }) => {
        const prev = options?.merge ? store.get(path) : undefined;
        store.set(path, { ...prev, ...value });
      },
    };
  }

  function docRef(path: string) {
    let ref = refs.get(path);
    if (!ref) {
      ref = makeDocRef(path);
      refs.set(path, ref);
    }
    return ref;
  }

  const mockRunTransaction = vi.fn(
    async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        get: (ref: ReturnType<typeof makeDocRef>) => ref.get(),
        set: (
          ref: ReturnType<typeof makeDocRef>,
          value: { next: number },
          options?: { merge?: boolean },
        ) => ref.set(value, options),
      };
      return fn(txn);
    },
  );

  const mockPortalFirestore = vi.fn(() => ({
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${name}/${id}`),
      // Supports the allocator's legacy-id collision check:
      // families.where('legacyFid','==',val).limit(1).get()
      where: (field: string, _op: string, val: string) => ({
        limit: (_n: number) => ({
          get: async () => {
            const hit = name === 'families' && field === 'legacyFid' && legacyIds.has(val);
            return {
              empty: !hit,
              docs: hit ? [{ id: 'CMT-legacy-owner', data: () => ({ legacyFid: val }) }] : [],
            };
          },
        }),
      }),
    }),
    runTransaction: mockRunTransaction,
  }));

  return { store, legacyIds, mockPortalFirestore };
});

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: mockPortalFirestore,
}));

import { allocateFamilyPublicId, allocateMemberPublicIds } from '../public-id-allocator';

beforeEach(() => {
  store.clear();
  legacyIds.clear();
  vi.clearAllMocks();
});

describe('public-id allocator', () => {
  it('family ids start at 1001 and increment', async () => {
    expect(await allocateFamilyPublicId()).toBe('1001');
    expect(await allocateFamilyPublicId()).toBe('1002');
  });

  it('skips a candidate that equals an existing legacy check-in id', async () => {
    // 1001 and 1002 are already some family's legacy id; the allocator must skip
    // them (they would collide under the kiosk legacy-first lookup) and hand out
    // the next non-legacy number.
    legacyIds.add('1001');
    legacyIds.add('1002');
    expect(await allocateFamilyPublicId()).toBe('1003');
    // The counter advanced past the skipped ids; the next allocation continues.
    legacyIds.add('1004');
    expect(await allocateFamilyPublicId()).toBe('1005');
  });

  it('member ids start at 50001 and reserve contiguous blocks', async () => {
    expect(await allocateMemberPublicIds(1)).toEqual(['50001']);
    expect(await allocateMemberPublicIds(3)).toEqual(['50002', '50003', '50004']);
  });

  it('rejects a non-positive count', async () => {
    await expect(allocateMemberPublicIds(0)).rejects.toThrow();
  });
});
