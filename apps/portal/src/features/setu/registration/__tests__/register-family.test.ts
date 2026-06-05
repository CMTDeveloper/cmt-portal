import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore mock ─────────────────────────────────────────────────────────────
// Use vi.hoisted so these are available inside the vi.mock factory
const { mockSet, mockGet, mockRunTransaction } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockGet: vi.fn(),
  mockRunTransaction: vi.fn(),
}));

function makeDocRef() {
  return {
    get: mockGet,
    set: mockSet,
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockImplementation(() => makeDocRef()),
    }),
  };
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockImplementation(() => makeDocRef()),
    }),
    runTransaction: mockRunTransaction,
  })),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));

import { registerFamily } from '../register-family';
import type { RegisterFamilyInput } from '../register-family';

const baseInput: RegisterFamilyInput = {
  email: 'raj.patel@gmail.com',
  phone: '+14165550100',
  familyName: 'Patel',
  location: 'Brampton',
  manager: { firstName: 'Raj', lastName: 'Patel', gender: 'Male' },
  additionalMembers: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerFamily — happy path', () => {
  it('runs a Firestore transaction and returns fid + mid', async () => {
    // Transaction succeeds: both contactKey docs do not exist
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        get: vi.fn().mockResolvedValue({ exists: false }),
        set: vi.fn(),
      };
      return fn(txn);
    });

    const result = await registerFamily(baseInput);

    expect(result.fid).toBeDefined();
    expect(result.mid).toMatch(new RegExp(`^${result.fid}-01$`));
    expect(mockRunTransaction).toHaveBeenCalledOnce();
  });

  it('fid uses the CMT- prefix followed by 8 random A-Z0-9 chars', async () => {
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = { get: vi.fn().mockResolvedValue({ exists: false }), set: vi.fn() };
      return fn(txn);
    });

    const { fid } = await registerFamily(baseInput);
    expect(fid).toMatch(/^CMT-[A-Z0-9]{8}$/);
  });

  it('creates contactKey docs inside the transaction for both email and phone', async () => {
    const txnSet = vi.fn();
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = { get: vi.fn().mockResolvedValue({ exists: false }), set: txnSet };
      return fn(txn);
    });

    await registerFamily(baseInput);

    // set should be called for: family doc + manager member doc + 2 contactKey docs = 4
    expect(txnSet).toHaveBeenCalledTimes(4);
  });

  it('creates N+1 member docs when additionalMembers provided', async () => {
    const txnSet = vi.fn();
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = { get: vi.fn().mockResolvedValue({ exists: false }), set: txnSet };
      return fn(txn);
    });

    await registerFamily({
      ...baseInput,
      additionalMembers: [
        { firstName: 'Diya', lastName: 'Patel', type: 'Child', gender: 'Female' },
        { firstName: 'Priya', lastName: 'Patel', type: 'Adult', gender: 'Female', email: 'priya@example.com' },
      ],
    });

    // family + manager + 2 additional + 2 contactKeys (email+phone for manager) + 1 contactKey (Priya email) = 7
    expect(txnSet).toHaveBeenCalledTimes(7);
  });

  it("writes a member's email + phone contactKeys pointing to THAT member (dedup invariant)", async () => {
    const txnSet = vi.fn();
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = { get: vi.fn().mockResolvedValue({ exists: false }), set: txnSet };
      return fn(txn);
    });

    const { fid } = await registerFamily({
      ...baseInput,
      additionalMembers: [
        { firstName: 'Priya', lastName: 'Patel', type: 'Adult', gender: 'Female', email: 'priya@example.com', phone: '+14165550199' },
      ],
    });

    // Priya is the first (only) additional member → mid `${fid}-02`.
    const priyaMid = `${fid}-02`;
    const contactKeyWrites = txnSet.mock.calls
      .map((c) => c[1] as { contactKey?: string; type?: string; mid?: string } | undefined)
      .filter((d): d is { contactKey: string; type: string; mid: string } =>
        !!d && typeof d.contactKey === 'string',
      );

    expect(contactKeyWrites.find((d) => d.type === 'email' && d.mid === priyaMid)).toBeDefined();
    expect(contactKeyWrites.find((d) => d.type === 'phone' && d.mid === priyaMid)).toBeDefined();
  });
});

describe('registerFamily — duplicate detection', () => {
  it('throws if email contactKey already exists', async () => {
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        // First get (email contactKey) returns exists: true
        get: vi.fn().mockResolvedValueOnce({ exists: true }).mockResolvedValue({ exists: false }),
        set: vi.fn(),
      };
      return fn(txn);
    });

    await expect(registerFamily(baseInput)).rejects.toThrow(/already registered/i);
  });

  it('throws if phone contactKey already exists', async () => {
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        // email get = not exists; phone get = exists
        get: vi.fn()
          .mockResolvedValueOnce({ exists: false })
          .mockResolvedValueOnce({ exists: true }),
        set: vi.fn(),
      };
      return fn(txn);
    });

    await expect(registerFamily(baseInput)).rejects.toThrow(/already registered/i);
  });
});
