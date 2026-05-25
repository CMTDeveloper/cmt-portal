import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks so they are available in vi.mock factories ────────────────────
const { mockRunTransaction, mockFetchLegacy } = vi.hoisted(() => ({
  mockRunTransaction: vi.fn(),
  mockFetchLegacy: vi.fn(),
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
        limit: vi.fn().mockReturnValue({}),
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

// ── Legacy parser mock ─────────────────────────────────────────────────────────
vi.mock('../legacy-parser', () => ({
  fetchLegacyFamilyForMigration: mockFetchLegacy,
}));

import { lazyMigrateLegacyFamily } from '../lazy-migrate';

const legacyShahFamily = {
  legacyFid: '42',
  familyName: 'Shah family',
  location: 'Brampton' as const,
  primaryFirstName: 'Asha',
  primaryLastName: 'Shah',
  primaryEmail: 'asha@example.com',
  primaryPhone: '4165550100',
  adults: [
    {
      firstName: 'Asha',
      lastName: 'Shah',
      gender: 'Female' as const,
      email: 'asha@example.com',
      phone: '4165550100',
      isPrimary: true,
    },
    {
      firstName: 'Ravi',
      lastName: 'Shah',
      gender: 'Male' as const,
      email: null,
      phone: null,
      isPrimary: false,
    },
  ],
  children: [
    {
      firstName: 'Anil',
      lastName: 'Shah',
      gender: 'Male' as const,
      schoolGrade: '3',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('lazyMigrateLegacyFamily — happy path', () => {
  it('creates the Setu family with legacyFid, location, and rich members', async () => {
    mockFetchLegacy.mockResolvedValue(legacyShahFamily);

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

    const result = await lazyMigrateLegacyFamily('42');

    expect(result.migrated).toBe(true);
    expect(result.legacyFid).toBe('42');
    expect(result.fid).toMatch(/^CMT-/);

    // Two adult members + one child + one family doc + at least two contact keys
    expect(txnSetCalls.length).toBeGreaterThanOrEqual(5);

    const familyDoc = txnSetCalls.find(([, data]) => 'managers' in data);
    expect(familyDoc?.[1]).toMatchObject({
      legacyFid: '42',
      location: 'Brampton',
      name: 'Shah family',
    });

    const managerDoc = txnSetCalls.find(([, data]) => data.manager === true);
    expect(managerDoc?.[1]).toMatchObject({
      firstName: 'Asha',
      lastName: 'Shah',
      gender: 'Female',
      email: 'asha@example.com',
      phone: '4165550100',
      type: 'Adult',
      manager: true,
    });

    const childDoc = txnSetCalls.find(([, data]) => data.type === 'Child');
    expect(childDoc?.[1]).toMatchObject({
      firstName: 'Anil',
      lastName: 'Shah',
      gender: 'Male',
      schoolGrade: '3',
    });

    const spouseDoc = txnSetCalls.find(
      ([, data]) => data.type === 'Adult' && data.manager === false,
    );
    expect(spouseDoc?.[1]).toMatchObject({
      firstName: 'Ravi',
      lastName: 'Shah',
      gender: 'Male',
    });
  });

  it('writes one contactKey per unique primary email/phone', async () => {
    mockFetchLegacy.mockResolvedValue(legacyShahFamily);

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
    // email + phone for the manager (primary's own contacts duplicate them, deduped)
    expect(contactKeyDocs.length).toBe(2);
  });
});

describe('lazyMigrateLegacyFamily — idempotency', () => {
  it('returns migrated=false and existing fid when Setu family already exists', async () => {
    mockFetchLegacy.mockResolvedValue(legacyShahFamily);

    const txnSet = vi.fn();
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        get: vi.fn().mockResolvedValue({
          empty: false,
          docs: [{ data: () => ({ fid: 'CMT-EXISTING', legacyFid: '42' }) }],
        }),
        set: txnSet,
      };
      return fn(txn);
    });

    const result = await lazyMigrateLegacyFamily('42');

    expect(result.migrated).toBe(false);
    expect(result.fid).toBe('CMT-EXISTING');
    expect(txnSet).not.toHaveBeenCalled();
  });
});

describe('lazyMigrateLegacyFamily — missing legacy family', () => {
  it('throws when the legacyFid is not in the roster', async () => {
    mockFetchLegacy.mockResolvedValue(null);
    await expect(lazyMigrateLegacyFamily('99999')).rejects.toThrow(/not found/i);
  });
});

describe('lazyMigrateLegacyFamily — no adult rows', () => {
  it('synthesizes a manager from the primary tuple when adults is empty', async () => {
    mockFetchLegacy.mockResolvedValue({
      ...legacyShahFamily,
      adults: [],
      children: [],
    });

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

    const managerDoc = txnSetCalls.find(([, data]) => data.manager === true);
    expect(managerDoc?.[1]).toMatchObject({
      firstName: 'Asha',
      lastName: 'Shah',
      manager: true,
      email: 'asha@example.com',
      phone: '4165550100',
    });
  });
});
