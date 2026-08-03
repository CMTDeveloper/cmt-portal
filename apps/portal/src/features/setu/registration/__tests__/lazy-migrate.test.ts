import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks so they are available in vi.mock factories ────────────────────
// `mockPreTxnQueryGet` backs the PRE-transaction existence read added by fix I-1
// (`db.collection('families').where('legacyFid','==',fid).limit(1).get()`). It
// defaults to an empty result (family not yet migrated). The idempotency test
// overrides it to a non-empty snapshot so we can assert NO allocation happens.
const { mockRunTransaction, mockFetchLegacy, mockPreTxnQueryGet } = vi.hoisted(() => ({
  mockRunTransaction: vi.fn(),
  mockFetchLegacy: vi.fn(),
  mockPreTxnQueryGet: vi.fn(async () => ({ empty: true, docs: [] as unknown[] })),
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
        // `.limit(1)` returns a query that supports BOTH `.get()` (pre-txn read)
        // and being passed to `txn.get()` (in-txn race-safe guard).
        limit: vi.fn().mockReturnValue({ get: mockPreTxnQueryGet }),
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

// ── Public-id allocator mock (issue #4) ─────────────────────────────────────────
// Mock so the allocator's OWN Firestore transactions don't run through the shared
// mockRunTransaction. The allocator has its own unit tests (Task 3); here we only
// verify lazyMigrateLegacyFamily threads the allocated ids onto the family + each
// member doc. Deterministic: family → '1001', members → contiguous from 50001.
const { mockAllocateFamilyPublicId, mockAllocateMemberPublicIds } = vi.hoisted(() => ({
  mockAllocateFamilyPublicId: vi.fn(async () => '1001'),
  mockAllocateMemberPublicIds: vi.fn(async (count: number) =>
    Array.from({ length: count }, (_, i) => String(50001 + i)),
  ),
}));
vi.mock('@/features/setu/ids/public-id-allocator', () => ({
  allocateFamilyPublicId: mockAllocateFamilyPublicId,
  allocateMemberPublicIds: mockAllocateMemberPublicIds,
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
      legacySid: '2',
      legacyLevel: 'Level 1 (Gr 1)',
      birthMonth: 9,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Restore the default pre-txn existence read (cleared by clearAllMocks):
  // family not yet migrated, so allocation + the txn proceed normally.
  mockPreTxnQueryGet.mockResolvedValue({ empty: true, docs: [] });
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
      birthMonth: 9,
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

// This is the test that catches a broken WRITER. The get-family-by-fid
// round-trip test seeds the Firestore doc directly, so it passes green even if
// nothing ever writes the flag - which is exactly how the read path and the
// write path each shipped inert in earlier drafts of this work.
describe('lazyMigrateLegacyFamily — locationNeedsConfirmation', () => {
  function captureFamilyDoc(): { calls: [unknown, Record<string, unknown>][] } {
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
    return { calls: txnSetCalls };
  }

  it('persists locationNeedsConfirmation: true when the parser defaulted the centre', async () => {
    mockFetchLegacy.mockResolvedValue({ ...legacyShahFamily, locationDefaulted: true });
    const { calls } = captureFamilyDoc();

    await lazyMigrateLegacyFamily('42');

    const familyDoc = calls.find(([, data]) => 'managers' in data)![1];
    expect(familyDoc.locationNeedsConfirmation).toBe(true);
    // location itself stays a valid non-empty string: FamilyDocSchema.location
    // is a read-validated z.string().min(1), so null/'' would fail validation on
    // EVERY subsequent read of this family.
    expect(familyDoc.location).toBe('Brampton');
  });

  it('OMITS the key entirely when the legacy centre was real', async () => {
    mockFetchLegacy.mockResolvedValue({
      ...legacyShahFamily,
      location: 'Scarborough' as const,
      locationDefaulted: false,
    });
    const { calls } = captureFamilyDoc();

    await lazyMigrateLegacyFamily('42');

    const familyDoc = calls.find(([, data]) => 'managers' in data)![1];
    // Omitted, never `false` - exactOptionalPropertyTypes is on, and the gate
    // and form both test `=== true`, so absence and false mean the same thing.
    expect('locationNeedsConfirmation' in familyDoc).toBe(false);
  });
});

describe('lazyMigrateLegacyFamily — portalAccess gating', () => {
  // 1 primary + 2 other adults — exercises the N=2 non-manager case so a second
  // gated adult can't be masked by code that only handled a single spouse.
  const legacyTwoSpouses = {
    ...legacyShahFamily,
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
        email: 'ravi@example.com',
        phone: null,
        isPrimary: false,
      },
      {
        firstName: 'Meena',
        lastName: 'Shah',
        gender: 'Female' as const,
        email: 'meena@example.com',
        phone: null,
        isPrimary: false,
      },
    ],
  };

  function runMigration(legacy: unknown): Promise<[unknown, Record<string, unknown>][]> {
    mockFetchLegacy.mockResolvedValue(legacy);
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
    return lazyMigrateLegacyFamily('42').then(() => txnSetCalls);
  }

  it('leaves the primary manager active (no portalAccess) and gates both other adults to pending', async () => {
    const calls = await runMigration(legacyTwoSpouses);

    const managerDoc = calls.find(([, d]) => d.manager === true);
    expect(managerDoc?.[1]).toMatchObject({ firstName: 'Asha', manager: true });
    // active ⇒ portalAccess is absent (never written), not the string 'active'.
    expect(managerDoc?.[1]).not.toHaveProperty('portalAccess');

    const gatedAdults = calls.filter(
      ([, d]) => d.type === 'Adult' && d.manager === false,
    );
    expect(gatedAdults).toHaveLength(2);
    const names = gatedAdults.map(([, d]) => d.firstName).sort();
    expect(names).toEqual(['Meena', 'Ravi']);
    for (const [, d] of gatedAdults) {
      expect(d.portalAccess).toBe('pending');
    }
  });

  it('does not set portalAccess on children', async () => {
    const calls = await runMigration(legacyTwoSpouses);
    const children = calls.filter(([, d]) => d.type === 'Child');
    expect(children.length).toBeGreaterThan(0);
    for (const [, d] of children) {
      expect(d).not.toHaveProperty('portalAccess');
    }
  });

  it('does not set portalAccess on a synthesized manager (adults empty)', async () => {
    const calls = await runMigration({
      ...legacyShahFamily,
      adults: [],
      children: [],
    });
    const managerDoc = calls.find(([, d]) => d.manager === true);
    expect(managerDoc?.[1]).toMatchObject({ firstName: 'Asha', manager: true });
    expect(managerDoc?.[1]).not.toHaveProperty('portalAccess');
  });
});

describe('lazyMigrateLegacyFamily — idempotency', () => {
  it('returns migrated=false and existing fid when the in-txn race-safe guard hits', async () => {
    // TOCTOU path: pre-txn read missed (empty, default), but a concurrent
    // first-migration wrote the family before this txn's guard read. The in-txn
    // check must still short-circuit without writing.
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

  // ── Fix I-1: no-op re-entry must NOT advance the bounded public-id counters ──
  it('short-circuits via the pre-txn read for an already-migrated family WITHOUT allocating public ids or opening a txn', async () => {
    mockFetchLegacy.mockResolvedValue(legacyShahFamily);

    // Pre-txn existence read finds the already-migrated family.
    mockPreTxnQueryGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ fid: 'CMT-EXISTING', legacyFid: '42' }) }],
    });

    const result = await lazyMigrateLegacyFamily('42');

    expect(result).toEqual({ migrated: false, fid: 'CMT-EXISTING', legacyFid: '42' });

    // The whole point of fix I-1: a no-op re-entry burns NO bounded public ids
    // and never opens the write transaction.
    expect(mockAllocateFamilyPublicId).not.toHaveBeenCalled();
    expect(mockAllocateMemberPublicIds).not.toHaveBeenCalled();
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });
});

describe('lazyMigrateLegacyFamily — missing legacy family', () => {
  it('throws when the legacyFid is not in the roster', async () => {
    mockFetchLegacy.mockResolvedValue(null);
    await expect(lazyMigrateLegacyFamily('99999')).rejects.toThrow(/not found/i);
  });
});

describe('lazyMigrateLegacyFamily — assigns publicFid/publicMid (issue #4)', () => {
  it('assigns publicFid to the family and a publicMid to every created member', async () => {
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

    const familyDoc = txnSetCalls.find(([, data]) => 'managers' in data);
    // publicFid is minted lazily at first enrollment (enrollFamily), NOT at migration.
    expect(familyDoc?.[1].publicFid).toBeUndefined();

    // legacyShahFamily: 2 adults + 1 child → 3 members, each carries a publicMid.
    // Member docs have a `manager` boolean; contactKey docs (also have `mid`+`type`)
    // do not — so gate on `manager` to exclude them.
    const memberDocs = txnSetCalls.filter(
      ([, data]) => typeof data.mid === 'string' && typeof data.manager === 'boolean',
    );
    expect(memberDocs).toHaveLength(3);
    expect(memberDocs.map(([, d]) => d.publicMid).sort()).toEqual(['50001', '50002', '50003']);
    for (const [, d] of memberDocs) {
      expect(typeof d.publicMid).toBe('string');
    }
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

// ── Departed children must not arrive as active students ─────────────────────
//
// The preventive half of the 2026-08-02 reports, and the higher-value one.
// ~299 dormant families were deliberately skipped at cutover and migrate on
// FIRST SIGN-IN, carrying roughly 205 children who left Bala Vihar years ago.
// Without this every one of them lands as an active Child, and the completion
// gate demands a school grade for someone who finished in 2019 - which is
// exactly the wall Sadeesh hit, arriving one family at a time, forever.
//
// The legacy roster already knows: the office stops assigning a level when a
// child leaves. `backfill-bv-enrollments.ts:168` has selected current students
// with exactly `legacyLevel != null` since before this feature existed, so this
// is that same established rule applied at import rather than at enrollment.
describe('lazyMigrateLegacyFamily — children with no legacy level', () => {
  function captureChildDocs(family: unknown) {
    mockFetchLegacy.mockResolvedValue(family);
    const txnSetCalls: [unknown, Record<string, unknown>][] = [];
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
        set: vi.fn().mockImplementation((_ref: unknown, data: Record<string, unknown>) => {
          txnSetCalls.push([_ref, data]);
        }),
      };
      return fn(txn);
    });
    return txnSetCalls;
  }

  // N=2, and the two must come out DIFFERENT - a blanket value passes a
  // one-child fixture either way.
  const twoChildren = {
    ...legacyShahFamily,
    children: [
      { ...legacyShahFamily.children[0]!, firstName: 'Anil', legacySid: '2', legacyLevel: 'Level 1 (Gr 1)' },
      { ...legacyShahFamily.children[0]!, firstName: 'Archish', legacySid: '3', legacyLevel: null },
    ],
  };

  it('imports a child with NO level as inactive, and their sibling as active', async () => {
    const calls = captureChildDocs(twoChildren);
    await lazyMigrateLegacyFamily('42');

    const kids = calls.map(([, d]) => d).filter((d) => d.type === 'Child');
    expect(kids).toHaveLength(2);

    const departed = kids.find((d) => d.firstName === 'Archish')!;
    expect(departed.participation).toBe('inactive');
    expect(departed.inactiveSource).toBe('legacy-migration');
    expect(departed.inactiveAt).toBeTruthy();

    const current = kids.find((d) => d.firstName === 'Anil')!;
    // Deliberately ABSENT rather than 'active'. Absent-means-active is the one
    // rule every reader already follows; writing the field on new docs only
    // would tempt someone into a `where('participation','==','active')` query
    // that silently drops all 2033 already-migrated members.
    expect(current.participation).toBeUndefined();
    expect(current.inactiveSource).toBeUndefined();
  });

  it('records the level it decided from, so the call is auditable', async () => {
    const calls = captureChildDocs(twoChildren);
    await lazyMigrateLegacyFamily('42');
    const kids = calls.map(([, d]) => d).filter((d) => d.type === 'Child');
    expect(kids.find((d) => d.firstName === 'Anil')!.legacyLevel).toBe('Level 1 (Gr 1)');
    expect(kids.find((d) => d.firstName === 'Archish')!.legacyLevel).toBeNull();
  });

  it('never retires an ADULT for the same reason (adults have no level at all)', async () => {
    // Adults carry no `legacyLevel`, so a rule written against the member rather
    // than the child row would retire every parent in the roster.
    const calls = captureChildDocs(twoChildren);
    await lazyMigrateLegacyFamily('42');
    const adults = calls.map(([, d]) => d).filter((d) => d.type === 'Adult');
    expect(adults.length).toBeGreaterThanOrEqual(2);
    expect(adults.every((d) => d.participation === undefined)).toBe(true);
  });
});
