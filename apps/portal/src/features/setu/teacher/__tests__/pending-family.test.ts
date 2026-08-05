import { describe, it, expect, vi, beforeEach } from 'vitest';

const { txnGet, txnSet, mockRunTxn } = vi.hoisted(() => ({ txnGet: vi.fn(), txnSet: vi.fn(), mockRunTxn: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));
vi.mock('@/features/setu/registration/generate-fid', () => ({ generateFid: () => 'CMT-NEW1' }));
vi.mock('@/features/setu/registration/hash-contact-key', () => ({ hashContactKey: (t: string, v: string) => `hash:${t}:${v}` }));

// Public-id allocator mock (issue #4). Deterministic: family → '1001', members →
// contiguous from 50001. The allocator has its own unit tests (Task 3); here we
// only verify upsertPendingFamilyChild threads the allocated ids onto the docs.
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

import { upsertPendingFamilyChild } from '../pending-family';

// A db whose collection().doc().collection() chain is inert (txn.get/set are mocked).
const db = {
  collection: (c: string) => ({ doc: (id: string) => ({ __c: c, __id: id, collection: (s: string) => ({ __c: s, doc: (sid: string) => ({ __c: s, __id: sid }) }) }) }),
  runTransaction: mockRunTxn,
} as unknown as Parameters<typeof upsertPendingFamilyChild>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mockRunTxn.mockImplementation(async (cb: (t: { get: typeof txnGet; set: typeof txnSet }) => Promise<unknown>) => cb({ get: txnGet, set: txnSet }));
});

const P = { levelLocation: 'Brampton', firstName: 'New', lastName: 'Kid', schoolGrade: 'Grade 2', gender: 'PreferNotToSay' as const, parentEmail: 'p@x.com', parentPhone: null };

describe('upsertPendingFamilyChild', () => {
  it('creates a new pending family keyed by email when unclaimed', async () => {
    txnGet.mockResolvedValueOnce({ exists: false }); // email contactKey lookup
    const r = await upsertPendingFamilyChild(db, P);
    expect(r).toEqual({ fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true });
    expect(txnSet).toHaveBeenCalledTimes(4); // family, manager, child, email contactKey
  });

  it('appends to an existing family when email already claims one', async () => {
    txnGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ fid: 'CMT-EXIST' }) })
      // Contiguous numbering: highest suffix is -02, so the next is -03.
      .mockResolvedValueOnce({ docs: [{ id: 'CMT-EXIST-01' }, { id: 'CMT-EXIST-02' }] });
    const r = await upsertPendingFamilyChild(db, P);
    expect(r).toEqual({ fid: 'CMT-EXIST', childMid: 'CMT-EXIST-03', createdFamily: false });
    expect(txnSet).toHaveBeenCalledTimes(1); // only the child member
  });

  // ── mid allocation must survive a gap in the numbering (task #129) ─────────
  //
  // This is not a hypothetical. `ids/member-mid.ts` exists because count+1 once
  // clobbered a real child: a family whose -02 had been deleted allocated -04
  // over the daughter already sitting there. The helper was written; this path
  // and invite-accept were never moved onto it.
  //
  // The gap is reachable in production today - staff member DELETE is live
  // (admin-only) on /welcome/family/{fid}/members/{mid}.
  it('appending to a family with a DELETED member does not overwrite the survivor', async () => {
    txnGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ fid: 'CMT-EXIST' }) })
      // -02 was deleted. Two members remain, so count+1 resolves to -03 - which
      // is TAKEN. Correct answer is highest-suffix+1 = -04.
      .mockResolvedValueOnce({ docs: [{ id: 'CMT-EXIST-01' }, { id: 'CMT-EXIST-03' }] });

    const r = await upsertPendingFamilyChild(db, P);

    expect(r.childMid).toBe('CMT-EXIST-04');
    // Assert the WRITE target too, not just the returned id: the id being right
    // while the doc lands somewhere else is precisely the failure that loses a
    // member, and the return value alone would not catch it.
    expect(txnSet).toHaveBeenCalledTimes(1);
    const [ref, payload] = txnSet.mock.calls[0] as [{ __id: string }, { mid: string }];
    expect(ref.__id).toBe('CMT-EXIST-04');
    expect(payload.mid).toBe('CMT-EXIST-04');
  });

  it('with NO email and NO phone, creates an un-claimable pending family (no contactKey)', async () => {
    const r = await upsertPendingFamilyChild(db, { ...P, parentEmail: null, parentPhone: null });
    expect(r).toEqual({ fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true });
    expect(txnGet).not.toHaveBeenCalled(); // no claim key → no lookup
    expect(txnSet).toHaveBeenCalledTimes(3); // family, manager, child — no contactKey
  });

  it('with phone only (no email), looks up + writes the phone contactKey', async () => {
    txnGet.mockResolvedValueOnce({ exists: false }); // phone contactKey lookup
    const r = await upsertPendingFamilyChild(db, { ...P, parentEmail: null, parentPhone: '416-555-0100' });
    expect(r.createdFamily).toBe(true);
    expect(txnSet).toHaveBeenCalledTimes(4); // family, manager, child, phone contactKey
  });

  // ── publicFid / publicMid (issue #4) ──────────────────────────────────────
  it('new family: assigns publicFid to the family + a publicMid to the manager and child', async () => {
    txnGet.mockResolvedValueOnce({ exists: false }); // email contactKey lookup → create new family
    await upsertPendingFamilyChild(db, P);

    const payloads = txnSet.mock.calls.map((c) => c[1] as Record<string, unknown>);
    const familyDoc = payloads.find((d) => 'managers' in d);
    // publicFid is minted lazily at first enrollment (enrollFamily), NOT when a teacher adds a child.
    expect(familyDoc?.publicFid).toBeUndefined();

    const memberDocs = payloads.filter(
      (d) => typeof d.mid === 'string' && typeof d.manager === 'boolean',
    );
    expect(memberDocs).toHaveLength(2); // manager + child
    expect(memberDocs.map((d) => d.publicMid).sort()).toEqual(['50001', '50002']);
    const child = memberDocs.find((d) => d.type === 'Child');
    expect(typeof child?.publicMid).toBe('string');
  });

  it('appends to existing family: child gets a publicMid (no publicFid — no new family)', async () => {
    txnGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ fid: 'CMT-EXIST' }) })
      .mockResolvedValueOnce({ docs: [{ id: 'CMT-EXIST-01' }, { id: 'CMT-EXIST-02' }] }); // → -03
    await upsertPendingFamilyChild(db, P);

    const payloads = txnSet.mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(payloads).toHaveLength(1); // only the child member
    const child = payloads[0]!;
    expect(child.type).toBe('Child');
    expect(child.publicMid).toBe('50001');
  });
});
