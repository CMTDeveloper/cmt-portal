import { vi, type Mock } from 'vitest';

/**
 * A path-keyed fake Firestore for the member/family write paths.
 *
 * Seeded by document path rather than by a `mockResolvedValueOnce` sequence,
 * which is the point: a sequence silently mis-binds the moment a transaction's
 * read order changes, so a refactor that reorders reads passes while the
 * production code reads the wrong document. Here a test says what EXISTS, and
 * the code under test finds it however it looks.
 */

export interface FakeRef {
  __path: string;
  id: string;
  collection(name: string): FakeCol;
}

export interface FakeCol {
  __path: string;
  doc(id?: string): FakeRef;
}

export interface FakeWrite {
  path: string;
  data: Record<string, unknown>;
}

export interface FakeTxn {
  get: Mock;
  set: Mock;
  delete: Mock;
  update: Mock;
}

export interface FakeDb {
  collection(name: string): FakeCol;
  runTransaction: Mock;
}

export interface FakeDbHarness {
  db: FakeDb;
  txn: FakeTxn;
  writes: FakeWrite[];
  deletes: string[];
  docs: Record<string, unknown>;
}

// The return type is spelled out rather than inferred: inferring it drags in
// @vitest/spy's internal path, which tsc refuses to name across the pnpm store.
export function makeFakeDb(docs: Record<string, unknown>): FakeDbHarness {
  const writes: FakeWrite[] = [];
  const deletes: string[] = [];
  let autoId = 0;

  function col(path: string): FakeCol {
    return {
      __path: path,
      doc(id?: string): FakeRef {
        const docId = id ?? `auto-${++autoId}`;
        return {
          __path: `${path}/${docId}`,
          id: docId,
          collection: (name: string) => col(`${path}/${docId}/${name}`),
        };
      },
    };
  }

  function snapFor(path: string) {
    const data = docs[path];
    return data === undefined
      ? { exists: false, data: () => undefined }
      : { exists: true, data: () => data };
  }

  const txn = {
    get: vi.fn(async (target: FakeRef | FakeCol) => {
      // A collection read (the members subcollection) returns docs; a doc read
      // returns a snapshot.
      if (!('id' in target)) {
        const prefix = `${target.__path}/`;
        const ids = Object.keys(docs)
          .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
          .map((p) => p.slice(prefix.length));
        return {
          size: ids.length,
          docs: ids.map((id) => ({ id, data: () => docs[`${prefix}${id}`] })),
        };
      }
      return snapFor(target.__path);
    }),
    set: vi.fn((ref: FakeRef, data: Record<string, unknown>) => {
      writes.push({ path: ref.__path, data });
    }),
    delete: vi.fn((ref: FakeRef) => {
      deletes.push(ref.__path);
    }),
    update: vi.fn(),
  };

  const db = {
    collection: (name: string) => col(name),
    runTransaction: vi.fn(async (fn: (t: typeof txn) => unknown) => fn(txn)),
  };

  return { db, txn, writes, deletes, docs };
}

/** The audit rows a run produced, in write order. */
export function auditRows(writes: FakeWrite[]): Record<string, unknown>[] {
  return writes.filter((w) => w.path.startsWith('audit_log/')).map((w) => w.data);
}
