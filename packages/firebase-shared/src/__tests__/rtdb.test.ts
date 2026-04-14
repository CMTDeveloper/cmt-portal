import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { masterRtdb, readRtdb } from '../admin/rtdb';

beforeEach(() => {
  vi.clearAllMocks();
  fakeRef.once.mockReset();
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

describe('rtdb exports', () => {
  it('does not export any write helpers', () => {
    expect(rtdbModule).not.toHaveProperty('writeRtdb');
    expect(rtdbModule).not.toHaveProperty('updateRtdb');
    expect(rtdbModule).not.toHaveProperty('pushRtdb');
    expect(rtdbModule).not.toHaveProperty('removeRtdb');
  });
});
