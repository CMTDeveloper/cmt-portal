import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fakeSnap = (value: unknown) => ({ val: () => value });

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn((_c, name) => ({ name })),
  cert: vi.fn((c) => c),
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

const fakeRef = { once: vi.fn() };
const fakeDb = { ref: vi.fn(() => fakeRef) };
vi.mock('firebase-admin/database', () => ({
  getDatabase: vi.fn(() => fakeDb),
}));

import { getDatabase } from 'firebase-admin/database';
import * as rtdbModule from '../admin/rtdb';
import { masterRtdb, readRtdb, __resetRtdbCacheForTests } from '../admin/rtdb';

beforeEach(() => {
  vi.clearAllMocks();
  fakeRef.once.mockReset();
  __resetRtdbCacheForTests();
  delete process.env.RTDB_SNAPSHOT_DIR;
  process.env.MASTER_FIREBASE_PROJECT_ID = 'm';
  process.env.MASTER_FIREBASE_CLIENT_EMAIL = 'sa@m.iam.gserviceaccount.com';
  process.env.MASTER_FIREBASE_PRIVATE_KEY = 'key';
  process.env.MASTER_FIREBASE_DATABASE_URL = 'https://m-default-rtdb.firebaseio.com';
});

describe('masterRtdb', () => {
  it('returns Database bound to the master app', () => {
    masterRtdb();
    expect(getDatabase).toHaveBeenCalledWith(expect.objectContaining({ name: 'master' }));
  });
});

describe('readRtdb', () => {
  it('reads a path and returns the value', async () => {
    fakeRef.once.mockResolvedValueOnce(fakeSnap({ fid: 42, name: 'Acme' }));
    const data = await readRtdb<{ fid: number; name: string }>('/families/42');
    expect(fakeDb.ref).toHaveBeenCalledWith('/families/42');
    expect(fakeRef.once).toHaveBeenCalledWith('value');
    expect(data).toEqual({ fid: 42, name: 'Acme' });
  });

  it('returns null when path is empty', async () => {
    fakeRef.once.mockResolvedValueOnce(fakeSnap(null));
    const data = await readRtdb('/families/999');
    expect(data).toBeNull();
  });
});

describe('readRtdb in-memory cache (live mode)', () => {
  it('serves repeat reads of the same path from cache (single network read)', async () => {
    fakeRef.once.mockResolvedValue(fakeSnap({ a: 1 }));
    const first = await readRtdb('/roster');
    const second = await readRtdb('/roster');
    expect(first).toEqual({ a: 1 });
    expect(second).toEqual({ a: 1 });
    expect(fakeRef.once).toHaveBeenCalledTimes(1);
  });

  it('caches null results too (missing nodes are not re-fetched)', async () => {
    fakeRef.once.mockResolvedValue(fakeSnap(null));
    await readRtdb('/families/404');
    await readRtdb('/families/404');
    expect(fakeRef.once).toHaveBeenCalledTimes(1);
  });

  it('different paths are cached independently', async () => {
    fakeRef.once.mockResolvedValueOnce(fakeSnap({ r: true })).mockResolvedValueOnce(fakeSnap({ f: true }));
    await readRtdb('/roster');
    await readRtdb('/families');
    expect(fakeRef.once).toHaveBeenCalledTimes(2);
  });

  it('re-fetches after the TTL expires', async () => {
    vi.useFakeTimers();
    try {
      fakeRef.once.mockResolvedValue(fakeSnap({ a: 1 }));
      await readRtdb('/roster');
      vi.advanceTimersByTime(16 * 60 * 1000); // > 15-min TTL
      await readRtdb('/roster');
      expect(fakeRef.once).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('readRtdb snapshot mode (RTDB_SNAPSHOT_DIR)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rtdb-snap-'));
    writeFileSync(join(dir, 'roster.json'), JSON.stringify({ '37': { fid: 16, fname: 'Surya' } }));
    writeFileSync(join(dir, 'families.json'), JSON.stringify({ '42': { fid: 42, name: 'Acme' } }));
    process.env.RTDB_SNAPSHOT_DIR = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a top-level node from the local snapshot, never touching the network', async () => {
    const data = await readRtdb<Record<string, unknown>>('/roster');
    expect(data).toEqual({ '37': { fid: 16, fname: 'Surya' } });
    expect(fakeDb.ref).not.toHaveBeenCalled();
    expect(fakeRef.once).not.toHaveBeenCalled();
  });

  it('walks keyed paths into the snapshot (e.g. /families/42)', async () => {
    const fam = await readRtdb<{ fid: number; name: string }>('/families/42');
    expect(fam).toEqual({ fid: 42, name: 'Acme' });
    expect(fakeRef.once).not.toHaveBeenCalled();
  });

  it('returns null for a missing key inside an existing snapshot file', async () => {
    const fam = await readRtdb('/families/999');
    expect(fam).toBeNull();
    expect(fakeRef.once).not.toHaveBeenCalled();
  });

  it('throws a run-snapshot hint when the snapshot file is missing (never falls back to network)', async () => {
    await expect(readRtdb('/doorCheckins')).rejects.toThrow(/snapshot:rtdb/);
    expect(fakeRef.once).not.toHaveBeenCalled();
  });
});

describe('rtdb exports', () => {
  it('does not export any write helpers', () => {
    expect(rtdbModule).not.toHaveProperty('writeRtdb');
    expect(rtdbModule).not.toHaveProperty('updateRtdb');
    expect(rtdbModule).not.toHaveProperty('pushRtdb');
    expect(rtdbModule).not.toHaveProperty('removeRtdb');
  });
});
