import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: (type: string, value: string) => `hash:${type}:${value.trim().toLowerCase()}`,
}));

const txnGet = vi.fn();
const txnSet = vi.fn();
const txnUpdate = vi.fn();
const mockRunTransaction = vi.fn();

// Each ref carries a __path string so assertions can target it. The chain
// db.collection('families').doc(fid).collection('members').doc(mid) yields
// __path = 'families/<fid>/members/<mid>'.
function makeRef(path: string): { __path: string; collection: (n: string) => { doc: (id: string) => unknown } } {
  return {
    __path: path,
    collection: (name: string) => ({
      doc: (id: string) => makeRef(`${path}/${name}/${id}`),
    }),
  };
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => makeRef(`${name}/${id}`),
    }),
    runTransaction: (fn: (txn: unknown) => Promise<unknown>) => mockRunTransaction(fn),
  }),
  FieldValue: {
    arrayUnion: (...vals: unknown[]) => ({ __arrayUnion: vals }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  },
}));

import { addVerifiedContact, ContactInUseError } from '../add-verified-contact';

function runTxnWith(existingContactKey: { fid: string; mid: string } | null) {
  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
    txnGet.mockImplementation(async (ref: { __path: string }) => {
      if (ref.__path.startsWith('contactKeys/')) {
        return existingContactKey
          ? { exists: true, data: () => existingContactKey }
          : { exists: false };
      }
      // member doc
      return { exists: true, data: () => ({ mid: 'CMT-AB12CD34-02' }) };
    });
    return fn({ get: txnGet, set: txnSet, update: txnUpdate });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addVerifiedContact', () => {
  it('writes a self-verified contactKey to this member and appends to altEmails', async () => {
    runTxnWith(null);
    await addVerifiedContact({
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
      type: 'email',
      value: 'priya.work@example.com',
    });

    const ckWrite = txnSet.mock.calls.find(
      ([ref]) => (ref as { __path: string }).__path === 'contactKeys/hash:email:priya.work@example.com',
    );
    expect(ckWrite).toBeDefined();
    expect(ckWrite?.[1]).toMatchObject({
      type: 'email',
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
      source: 'self-verified',
    });
    // member altEmails appended via arrayUnion on the nested member ref
    expect(txnUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ __path: 'families/CMT-AB12CD34/members/CMT-AB12CD34-02' }),
      expect.objectContaining({ altEmails: { __arrayUnion: ['priya.work@example.com'] } }),
    );
  });

  it('is idempotent when the contact already maps to THIS member', async () => {
    runTxnWith({ fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-02' });
    await addVerifiedContact({
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
      type: 'phone',
      value: '+14165550200',
    });
    // No throw; no duplicate contactKey write (already owned by this member).
    expect(txnSet).not.toHaveBeenCalled();
  });

  it('refuses (ContactInUseError) when the contact maps to a DIFFERENT member', async () => {
    runTxnWith({ fid: 'OTHER-FAMILY', mid: 'OTHER-FAMILY-01' });
    await expect(
      addVerifiedContact({
        fid: 'CMT-AB12CD34',
        mid: 'CMT-AB12CD34-02',
        type: 'email',
        value: 'taken@example.com',
      }),
    ).rejects.toBeInstanceOf(ContactInUseError);
    expect(txnSet).not.toHaveBeenCalled();
  });

  it('claims/repairs an orphaned contactKey (exists but no mid) and writes the member update', async () => {
    runTxnWith({ fid: 'CMT-AB12CD34' } as unknown as { fid: string; mid: string });
    await addVerifiedContact({
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
      type: 'email',
      value: 'orphan@example.com',
    });
    const ckWrite = txnSet.mock.calls.find(
      ([ref]) => (ref as { __path: string }).__path === 'contactKeys/hash:email:orphan@example.com',
    );
    expect(ckWrite).toBeDefined();
    expect(ckWrite?.[1]).toMatchObject({ source: 'self-verified', mid: 'CMT-AB12CD34-02' });
  });

  it('appends to altPhones (not altEmails) for phone type', async () => {
    runTxnWith(null);
    await addVerifiedContact({
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
      type: 'phone',
      value: '+14165550200',
    });
    expect(txnUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ __path: 'families/CMT-AB12CD34/members/CMT-AB12CD34-02' }),
      expect.objectContaining({ altPhones: { __arrayUnion: ['+14165550200'] } }),
    );
    expect(txnUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ altEmails: expect.anything() }),
    );
  });
});
