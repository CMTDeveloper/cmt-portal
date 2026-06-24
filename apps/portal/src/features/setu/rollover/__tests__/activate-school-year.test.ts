import { describe, it, expect, vi } from 'vitest';

// FieldValue.serverTimestamp() must return a recognizable sentinel. portalFirestore
// is exported only so @/lib/seva-requirement (which imports it at module load for
// its own helpers) resolves cleanly — activateSchoolYear itself only pulls the
// DEFAULT_SEVA_REQUIREMENT const from that module.
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__serverTimestamp__' },
  portalFirestore: vi.fn(),
}));

import { activateSchoolYear } from '../activate-school-year';

interface RecordedWrite {
  path: string;
  data: Record<string, unknown>;
  merge: boolean;
}

/** Minimal fake Firestore that records every write made inside runTransaction so
 *  we can assert BOTH app_config docs are written in the SAME transaction. */
function makeDb(sevaData: Record<string, unknown> | undefined) {
  const writes: RecordedWrite[] = [];
  let transactions = 0;
  const ref = (path: string) => ({ __path: path });
  const db = {
    collection: (c: string) => ({ doc: (d: string) => ref(`${c}/${d}`) }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      transactions += 1;
      const tx = {
        get: async (r: { __path: string }) => ({
          data: () => (r.__path === 'app_config/seva_requirement' ? sevaData : undefined),
        }),
        set: (r: { __path: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
          writes.push({ path: r.__path, data, merge: opts?.merge ?? false });
        },
      };
      return fn(tx);
    },
  };
  return { db, writes, txCount: () => transactions };
}

describe('activateSchoolYear', () => {
  it('writes both app_config docs in ONE transaction, preserving hoursPerYear', async () => {
    const { db, writes, txCount } = makeDb({ hoursPerYear: 25, currentSevaYear: '2025-26' });

    const result = await activateSchoolYear(db as never, { toYear: '2026-27', actorMid: 'A1' });

    expect(result).toEqual({ config: { currentYear: '2026-27' }, sevaYear: '2026-27' });
    expect(txCount()).toBe(1); // a single atomic transaction
    expect(writes).toHaveLength(2);

    const year = writes.find((w) => w.path === 'app_config/school_year');
    expect(year?.merge).toBe(true);
    expect(year?.data).toMatchObject({ currentYear: '2026-27', updatedBy: 'A1' });

    const seva = writes.find((w) => w.path === 'app_config/seva_requirement');
    expect(seva?.data).toMatchObject({ currentSevaYear: '2026-27', hoursPerYear: 25 });
  });

  it('falls back to the default hoursPerYear when seva config is absent', async () => {
    const { db, writes } = makeDb(undefined);

    await activateSchoolYear(db as never, { toYear: '2026-27', actorMid: 'A1' });

    const seva = writes.find((w) => w.path === 'app_config/seva_requirement');
    expect(seva?.data).toMatchObject({ hoursPerYear: 20, currentSevaYear: '2026-27' });
  });

  it('rejects a malformed target year before any write', async () => {
    const { db, writes } = makeDb({ hoursPerYear: 20, currentSevaYear: '2025-26' });
    await expect(activateSchoolYear(db as never, { toYear: 'nope', actorMid: 'A1' })).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });
});
