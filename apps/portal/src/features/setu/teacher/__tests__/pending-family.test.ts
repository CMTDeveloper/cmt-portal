import { describe, it, expect, vi, beforeEach } from 'vitest';

const { txnGet, txnSet, mockRunTxn } = vi.hoisted(() => ({ txnGet: vi.fn(), txnSet: vi.fn(), mockRunTxn: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));
vi.mock('@/features/setu/registration/generate-fid', () => ({ generateFid: () => 'CMT-NEW1' }));
vi.mock('@/features/setu/registration/hash-contact-key', () => ({ hashContactKey: (t: string, v: string) => `hash:${t}:${v}` }));

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
      .mockResolvedValueOnce({ size: 2 }); // members size → -03
    const r = await upsertPendingFamilyChild(db, P);
    expect(r).toEqual({ fid: 'CMT-EXIST', childMid: 'CMT-EXIST-03', createdFamily: false });
    expect(txnSet).toHaveBeenCalledTimes(1); // only the child member
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
});
