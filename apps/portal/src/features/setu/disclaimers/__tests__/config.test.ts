import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_DISCLAIMERS_CONFIG } from '@cmt/shared-domain/setu';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__' },
}));

import { getDisclaimersConfig, setDisclaimersConfig } from '../config';

// Minimal fake Firestore: a single app_config/disclaimers doc + runTransaction.
function fakeDb(initial: Record<string, unknown> | null) {
  let doc = initial;
  const ref = {
    get: async () => ({ exists: doc !== null, data: () => doc }),
    set: async (data: Record<string, unknown>) => {
      doc = { ...(doc ?? {}), ...data };
    },
  };
  const db = {
    collection: () => ({ doc: () => ref }),
    runTransaction: async (fn: (txn: unknown) => Promise<unknown>) =>
      fn({
        get: async () => ({ exists: doc !== null, data: () => doc }),
        set: (_ref: unknown, data: Record<string, unknown>) => {
          doc = { ...(doc ?? {}), ...data };
        },
      }),
  };
  return { db: db as unknown as FirebaseFirestore.Firestore, read: () => doc };
}

const SECTIONS = DEFAULT_DISCLAIMERS_CONFIG.sections;

describe('getDisclaimersConfig', () => {
  it('returns the DEFAULT (version 1) when the doc is absent', async () => {
    const { db } = fakeDb(null);
    const cfg = await getDisclaimersConfig(db);
    expect(cfg.version).toBe(1);
    expect(cfg.sections).toHaveLength(4);
  });

  it('returns the stored config when present and valid', async () => {
    const { db } = fakeDb({ version: 5, sections: SECTIONS });
    const cfg = await getDisclaimersConfig(db);
    expect(cfg.version).toBe(5);
  });

  it('falls back to DEFAULT when the stored doc is invalid', async () => {
    const { db } = fakeDb({ version: 'nope' });
    const cfg = await getDisclaimersConfig(db);
    expect(cfg.version).toBe(1);
  });
});

describe('setDisclaimersConfig', () => {
  it('writes version 2 when publishing changed content over an absent doc', async () => {
    const { db, read } = fakeDb(null);
    const edited = SECTIONS.map((s, i) => (i === 0 ? { ...s, body: 'Edited body.' } : s));
    const result = await setDisclaimersConfig(db, edited, 'mid-admin');
    expect(result.version).toBe(2);
    expect((read() as { version: number }).version).toBe(2);
    expect((read() as { updatedBy: string }).updatedBy).toBe('mid-admin');
  });

  it('bumps version by exactly 1 over an existing doc', async () => {
    const { db } = fakeDb({ version: 7, sections: SECTIONS });
    const edited = SECTIONS.map((s, i) => (i === 0 ? { ...s, title: 'New title' } : s));
    const result = await setDisclaimersConfig(db, edited, 'mid-admin');
    expect(result.version).toBe(8);
  });

  it('does NOT bump when the content is identical (no needless re-prompt)', async () => {
    const { db } = fakeDb({ version: 7, sections: SECTIONS });
    const result = await setDisclaimersConfig(db, SECTIONS, 'mid-admin');
    expect(result.version).toBe(7);
  });
});
