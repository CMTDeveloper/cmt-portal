import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Stateful fake Firestore harness ───────────────────────────────────────────
// Mirrors the mock style of
// features/setu/registration/__tests__/register-family.test.ts
// (vi.hoisted + vi.mock('@cmt/firebase-shared/admin/firestore') exposing
// portalFirestore().runTransaction with a txn.get/txn.set shape), but keeps an
// in-memory `counters` store so allocations persist + increment ACROSS calls
// within a single test — the allocator opens its OWN runTransaction each call,
// so the second call must observe the first call's write.
const { store, mockPortalFirestore } = vi.hoisted(() => {
  // path "counters/{name}" -> { next: number }
  const store = new Map<string, { next: number }>();
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
    }),
    runTransaction: mockRunTransaction,
  }));

  return { store, mockPortalFirestore };
});

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: mockPortalFirestore,
}));

import { allocateFamilyPublicId, allocateMemberPublicIds } from '../public-id-allocator';

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('public-id allocator', () => {
  it('family ids start at 1001 and increment', async () => {
    expect(await allocateFamilyPublicId()).toBe('1001');
    expect(await allocateFamilyPublicId()).toBe('1002');
  });

  it('member ids start at 50001 and reserve contiguous blocks', async () => {
    expect(await allocateMemberPublicIds(1)).toEqual(['50001']);
    expect(await allocateMemberPublicIds(3)).toEqual(['50002', '50003', '50004']);
  });

  it('rejects a non-positive count', async () => {
    await expect(allocateMemberPublicIds(0)).rejects.toThrow();
  });
});
