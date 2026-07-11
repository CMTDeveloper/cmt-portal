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

// Mock the public-id allocator so its OWN Firestore transactions don't run through
// the shared mockRunTransaction (that would pollute call counts and consume the
// duplicate-detection tests' mockResolvedValueOnce queues). The allocator has its
// own unit tests (Task 3); here we only verify that registerFamily threads the
// allocated ids onto the family + member docs. Default: family → '1001', members
// → contiguous from 50001 so the issue-#4 assertion stays deterministic.
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

import { registerFamily, deriveBirthMonth } from '../register-family';
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

  it('writes familyAddress onto the family doc when supplied', async () => {
    const txnSet = vi.fn();
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = { get: vi.fn().mockResolvedValue({ exists: false }), set: txnSet };
      return fn(txn);
    });

    const address = { street: '123 Main St', unit: '', city: 'Brampton', province: 'ON', postalCode: 'L6T 1A1' };
    await registerFamily({ ...baseInput, familyAddress: address });

    // The family doc is the FIRST txn.set call.
    const familyDoc = txnSet.mock.calls[0]?.[1] as { familyAddress?: unknown };
    expect(familyDoc.familyAddress).toEqual(address);
  });

  it('omits familyAddress from the family doc when not supplied (never writes undefined)', async () => {
    const txnSet = vi.fn();
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = { get: vi.fn().mockResolvedValue({ exists: false }), set: txnSet };
      return fn(txn);
    });

    await registerFamily(baseInput);

    const familyDoc = txnSet.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('familyAddress' in familyDoc).toBe(false);
  });
});

describe('deriveBirthMonth', () => {
  it('parses YYYY-MM into the numeric month (1-12)', () => {
    expect(deriveBirthMonth('2016-03')).toBe(3);
    expect(deriveBirthMonth('2020-12')).toBe(12);
    expect(deriveBirthMonth('2020-01')).toBe(1);
  });
  it('returns null for absent/blank/non-YYYY-MM input', () => {
    expect(deriveBirthMonth(undefined)).toBeNull();
    expect(deriveBirthMonth(null)).toBeNull();
    expect(deriveBirthMonth('')).toBeNull();
    expect(deriveBirthMonth('Mar 2016')).toBeNull();
    expect(deriveBirthMonth('2016-13')).toBeNull();
    expect(deriveBirthMonth('2016-00')).toBeNull();
  });
});

describe('registerFamily — persists the full member matrix (no hardcoded []/null)', () => {
  function captureSets() {
    const txnSet = vi.fn();
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = { get: vi.fn().mockResolvedValue({ exists: false }), set: txnSet };
      return fn(txn);
    });
    return txnSet;
  }

  // The manager member doc is the SECOND set() call (family doc is first).
  function managerDoc(txnSet: ReturnType<typeof vi.fn>) {
    return txnSet.mock.calls.map((c) => c[1] as Record<string, unknown>).find((d) => d?.manager === true);
  }
  function memberDocByFirstName(txnSet: ReturnType<typeof vi.fn>, firstName: string) {
    return txnSet.mock.calls
      .map((c) => c[1] as Record<string, unknown>)
      .find((d) => d?.firstName === firstName && d?.manager === false);
  }

  it('persists the manager foodAllergies + volunteeringSkills (not hardcoded null/[])', async () => {
    const txnSet = captureSets();
    await registerFamily({
      ...baseInput,
      manager: {
        firstName: 'Raj', lastName: 'Patel', gender: 'Male',
        foodAllergies: 'Peanuts', volunteeringSkills: ['Setup', 'Kitchen'],
      },
    });
    const mgr = managerDoc(txnSet);
    expect(mgr?.foodAllergies).toBe('Peanuts');
    expect(mgr?.volunteeringSkills).toEqual(['Setup', 'Kitchen']);
    expect(mgr?.birthMonth).toBeNull(); // adult manager has no birth month
  });

  it('persists a child member schoolGrade/birthMonthYear AND derives birthMonth', async () => {
    const txnSet = captureSets();
    await registerFamily({
      ...baseInput,
      additionalMembers: [
        {
          firstName: 'Diya', lastName: 'Patel', type: 'Child', gender: 'Female',
          foodAllergies: 'None', schoolGrade: 'Grade 5', birthMonthYear: '2016-03',
        },
      ],
    });
    const diya = memberDocByFirstName(txnSet, 'Diya');
    expect(diya?.schoolGrade).toBe('Grade 5');
    expect(diya?.birthMonthYear).toBe('2016-03');
    expect(diya?.birthMonth).toBe(3); // derived from '2016-03'
    expect(diya?.foodAllergies).toBe('None');
  });

  it('persists an adult member volunteeringSkills (not hardcoded [])', async () => {
    const txnSet = captureSets();
    await registerFamily({
      ...baseInput,
      additionalMembers: [
        {
          firstName: 'Priya', lastName: 'Patel', type: 'Adult', gender: 'Female',
          foodAllergies: 'None', email: 'priya@example.com', phone: '+14165550199',
          volunteeringSkills: ['Decor'],
        },
      ],
    });
    const priya = memberDocByFirstName(txnSet, 'Priya');
    expect(priya?.volunteeringSkills).toEqual(['Decor']);
    expect(priya?.birthMonth).toBeNull(); // no birthMonthYear → null
  });
});

describe('registerFamily — assigns publicFid/publicMid (issue #4)', () => {
  // NOTE: the brief's assertion read back docs via a `fakeDb.collection(...).get()`,
  // but THIS harness has no fake-firestore — it uses vi.fn mocks and captures
  // `txn.set` payloads (see the rest of this file). So we adapt the assertion to
  // the harness's actual read API: inspect the captured set() payloads. The
  // public-id-allocator is mocked above (family → '1001', members → 50001+i), so
  // mockRunTransaction only has to serve registerFamily's own transaction.
  it('assigns publicFid to the family and a publicMid to every member', async () => {
    const txnSet = vi.fn();
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = { get: vi.fn().mockResolvedValue({ exists: false }), set: txnSet };
      return fn(txn);
    });

    const res = await registerFamily({
      ...baseInput,
      email: 'a@b.com',
      phone: '+14165550000',
      familyName: 'Iyer',
      location: 'Brampton',
      manager: { firstName: 'Asha', lastName: 'Iyer', gender: 'Female' },
      additionalMembers: [
        { firstName: 'Dev', lastName: 'Iyer', type: 'Child', gender: 'Male' },
        { firstName: 'Mira', lastName: 'Iyer', type: 'Child', gender: 'Female' },
      ],
    });

    const payloads = txnSet.mock.calls.map((c) => c[1] as Record<string, unknown>);
    const fam = payloads.find((d) => d?.fid === res.fid && d?.name === 'Iyer');
    expect(fam?.publicFid).toBe('1001');

    const members = payloads.filter(
      (d) => typeof d?.mid === 'string' && (d?.manager === true || d?.manager === false),
    );
    expect(members.map((m) => m.publicMid).sort()).toEqual(['50001', '50002', '50003']);
    // Manager (mid -01) holds the first allocated public mid.
    const manager = members.find((m) => m.manager === true);
    expect(manager?.publicMid).toBe('50001');
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

describe('registerFamily — same-family contact reuse (owner decision #3)', () => {
  type ContactKeyDoc = { contactKey: string; type: string; fid: string; mid: string };
  function contactKeyDocs(txnSet: ReturnType<typeof vi.fn>): ContactKeyDoc[] {
    return txnSet.mock.calls
      .map((c) => c[1] as Partial<ContactKeyDoc> | undefined)
      .filter((d): d is ContactKeyDoc => !!d && typeof d.contactKey === 'string');
  }

  it('ALLOWS an additional adult to reuse the manager email + phone (shared key, manager keeps ownership)', async () => {
    const txnSet = vi.fn();
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      // No contactKey pre-exists (brand-new family).
      const txn = { get: vi.fn().mockResolvedValue({ exists: false }), set: txnSet };
      return fn(txn);
    });

    // Aarti (an adult) reuses the manager's own email + phone — allowed.
    const result = await registerFamily({
      ...baseInput,
      additionalMembers: [
        {
          firstName: 'Aarti', lastName: 'Patel', type: 'Adult', gender: 'Female',
          foodAllergies: 'None', volunteeringSkills: ['Kitchen'],
          email: baseInput.email, phone: baseInput.phone,
        },
      ],
    });

    expect(result.fid).toBeDefined();
    // Exactly ONE contactKey per unique hash (manager email + manager phone), and
    // both point to the MANAGER (-01), not the reusing member (-02) — so the
    // manager's own sign-in still resolves to the manager, not Aarti.
    const keys = contactKeyDocs(txnSet);
    const managerMid = `${result.fid}-01`;
    const emailKeys = keys.filter((d) => d.type === 'email');
    const phoneKeys = keys.filter((d) => d.type === 'phone');
    expect(emailKeys).toHaveLength(1);
    expect(phoneKeys).toHaveLength(1);
    expect(emailKeys[0]?.mid).toBe(managerMid);
    expect(phoneKeys[0]?.mid).toBe(managerMid);
  });

  it('still REJECTS two NON-manager members claiming the same NEW contact (genuinely ambiguous)', async () => {
    const txnSet = vi.fn();
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = { get: vi.fn().mockResolvedValue({ exists: false }), set: txnSet };
      return fn(txn);
    });

    await expect(
      registerFamily({
        ...baseInput,
        additionalMembers: [
          { firstName: 'Priya', lastName: 'Patel', type: 'Adult', gender: 'Female', phone: '+14165550199' },
          { firstName: 'Arjun', lastName: 'Patel', type: 'Adult', gender: 'Male', phone: '+14165550199' },
        ],
      }),
    ).rejects.toThrow('duplicate-contact-in-form');

    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(txnSet).not.toHaveBeenCalled();
  });
});
