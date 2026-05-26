import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSet, mockGet, mockUpdate, mockRunTransaction } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockRunTransaction: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const docRef = {
    get: mockGet,
    set: mockSet,
    update: mockUpdate,
  };
  const collRef = {
    doc: vi.fn(() => docRef),
  };
  return {
    portalFirestore: () => ({
      collection: vi.fn(() => collRef),
      runTransaction: mockRunTransaction,
    }),
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    },
    Timestamp: {
      fromDate: (d: Date) => ({ toDate: () => d, _isTimestamp: true }),
    },
  };
});

vi.mock('@cmt/shared-domain/setu', () => ({
  normalizeContactForKey: (_type: string, value: string) => value.trim().toLowerCase(),
}));

import { createMagicLink, consumeMagicLink } from '../magic-links';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createMagicLink', () => {
  it('stores a doc with canonical email, expiresAt ~10min, usedAt null, and returns token + expiresAt', async () => {
    mockSet.mockResolvedValue(undefined);

    const before = Date.now();
    const result = await createMagicLink('  User@Example.COM  ');
    const after = Date.now();

    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(0);
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 10 * 60 * 1000 - 100);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 10 * 60 * 1000 + 100);

    expect(mockSet).toHaveBeenCalledOnce();
    const [docArg] = mockSet.mock.calls[0] as [Record<string, unknown>];
    expect(docArg.email).toBe('user@example.com');
    expect(docArg.usedAt).toBeNull();
    expect(docArg.createdAt).toBe('SERVER_TIMESTAMP');
  });

  it('generates a unique token each call', async () => {
    mockSet.mockResolvedValue(undefined);
    const a = await createMagicLink('a@example.com');
    const b = await createMagicLink('a@example.com');
    expect(a.token).not.toBe(b.token);
  });
});

describe('consumeMagicLink', () => {
  it('returns null when doc does not exist', async () => {
    mockRunTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = { get: vi.fn().mockResolvedValue({ exists: false }), update: mockUpdate };
      return fn(tx);
    });

    const result = await consumeMagicLink('no-such-token');
    expect(result).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns null when doc is already used', async () => {
    mockRunTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            email: 'user@example.com',
            usedAt: { toDate: () => new Date(Date.now() - 5000) },
            expiresAt: { toDate: () => new Date(Date.now() + 60_000), _isTimestamp: true },
          }),
        }),
        update: mockUpdate,
      };
      return fn(tx);
    });

    const result = await consumeMagicLink('already-used');
    expect(result).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns null when token is expired', async () => {
    mockRunTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            email: 'user@example.com',
            usedAt: null,
            expiresAt: { toDate: () => new Date(Date.now() - 1000), _isTimestamp: true },
          }),
        }),
        update: mockUpdate,
      };
      return fn(tx);
    });

    const result = await consumeMagicLink('expired-token');
    expect(result).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('marks usedAt and returns email on valid token', async () => {
    mockRunTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            email: 'user@example.com',
            usedAt: null,
            expiresAt: { toDate: () => new Date(Date.now() + 60_000), _isTimestamp: true },
          }),
        }),
        update: mockUpdate,
      };
      return fn(tx);
    });

    const result = await consumeMagicLink('valid-token');
    expect(result).toEqual({ email: 'user@example.com' });
    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), { usedAt: 'SERVER_TIMESTAMP' });
  });
});
