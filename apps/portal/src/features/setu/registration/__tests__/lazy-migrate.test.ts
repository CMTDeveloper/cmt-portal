import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks so they are available in vi.mock factories ────────────────────
const { mockRunTransaction, mockFindFamilyById } = vi.hoisted(() => ({
  mockRunTransaction: vi.fn(),
  mockFindFamilyById: vi.fn(),
}));

// ── Firestore mock ─────────────────────────────────────────────────────────────
vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  function makeDocRef(): Record<string, unknown> {
    return {
      get: vi.fn(),
      set: vi.fn(),
      collection: vi.fn().mockImplementation(() => makeCollRef()),
    };
  }

  function makeCollRef(): Record<string, unknown> {
    return {
      doc: vi.fn().mockImplementation(() => makeDocRef()),
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ /* query ref — get called via txn.get */ }),
      }),
    };
  }

  return {
    portalFirestore: vi.fn(() => ({
      collection: vi.fn().mockImplementation(() => makeCollRef()),
      runTransaction: mockRunTransaction,
    })),
    FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
  };
});

// ── Legacy RTDB mock ───────────────────────────────────────────────────────────
vi.mock('@/features/check-in/shared/rtdb/family-lookup', () => ({
  findFamilyById: mockFindFamilyById,
}));

import { lazyMigrateLegacyFamily } from '../lazy-migrate';

const legacyFamily = {
  fid: '42',
  name: 'Sharma family',
  contacts: [
    { type: 'email' as const, value: 'sharma@example.com' },
    { type: 'phone' as const, value: '4165550200' },
  ],
  paymentStatus: 'paid' as const,
  students: [
    { sid: '101', fid: '42', firstName: 'Anil', lastName: 'Sharma', level: '3' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('lazyMigrateLegacyFamily — happy path', () => {
  it('creates a Setu family with legacyFid populated', async () => {
    mockFindFamilyById.mockResolvedValue(legacyFamily);

    const txnSetCalls: unknown[][] = [];
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        // First get = idempotency query → empty (no existing Setu family)
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
        set: vi.fn().mockImplementation((...args: unknown[]) => txnSetCalls.push(args)),
      };
      return fn(txn);
    });

    const result = await lazyMigrateLegacyFamily('42');

    expect(result.migrated).toBe(true);
    expect(result.fid).toBeDefined();
    expect(result.legacyFid).toBe('42');
    expect(mockRunTransaction).toHaveBeenCalledOnce();
    // family doc + manager member + 1 student member + 2 contactKey docs = 5
    expect(txnSetCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('writes contactKey docs for each contact in the legacy family', async () => {
    mockFindFamilyById.mockResolvedValue(legacyFamily);

    const txnSetCalls: [unknown, Record<string, unknown>][] = [];
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
        set: vi.fn().mockImplementation((ref: unknown, data: Record<string, unknown>) => {
          txnSetCalls.push([ref, data]);
        }),
      };
      return fn(txn);
    });

    await lazyMigrateLegacyFamily('42');

    const contactKeyDocs = txnSetCalls.filter(([, data]) => 'contactKey' in data);
    // email + phone = 2 contactKey docs
    expect(contactKeyDocs.length).toBe(2);
  });
});

describe('lazyMigrateLegacyFamily — idempotency', () => {
  it('returns migrated=false and existing fid when Setu family already exists for legacyFid', async () => {
    mockFindFamilyById.mockResolvedValue(legacyFamily);

    const txnSet = vi.fn();
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        get: vi.fn().mockResolvedValue({
          empty: false,
          docs: [{ data: () => ({ fid: 'EXISTING01234', legacyFid: '42' }) }],
        }),
        set: txnSet,
      };
      return fn(txn);
    });

    const result = await lazyMigrateLegacyFamily('42');

    expect(result.migrated).toBe(false);
    expect(result.fid).toBe('EXISTING01234');
    expect(txnSet).not.toHaveBeenCalled();
  });
});

describe('lazyMigrateLegacyFamily — missing legacy family', () => {
  it('throws when legacyFid not found in RTDB', async () => {
    mockFindFamilyById.mockResolvedValue(null);

    await expect(lazyMigrateLegacyFamily('99999')).rejects.toThrow(/not found/i);
  });
});
