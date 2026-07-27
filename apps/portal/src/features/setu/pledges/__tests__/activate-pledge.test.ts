import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `claimPledgeActivation` is tested DIRECTLY, not only through `finalizePledge`.
 *
 * That distinction is the whole point: `finalizePledge` returns early for a
 * cancelled or failed pledge, so exercising the claim only through it can never
 * reach the claim's own status guard. The reconciler cron calls this function
 * with whatever it finds in Firestore, so the guard has to hold on its own -
 * a mutation run caught exactly this gap.
 */

type Doc = Record<string, unknown>;
const { fs } = vi.hoisted(() => ({
  fs: { pledge: null as Doc | null, txnUpdates: [] as Doc[] },
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: () => db }));
const { mockEmail } = vi.hoisted(() => ({ mockEmail: vi.fn() }));
vi.mock('@/lib/aws/send-managed-email', () => ({ sendManagedEmail: mockEmail }));

const db = {
  collection: () => ({ doc: () => ({}) }),
  runTransaction: async (fn: (t: unknown) => Promise<unknown>) =>
    fn({
      get: async () => ({ exists: fs.pledge !== null, data: () => fs.pledge }),
      update: (_ref: unknown, d: Doc) => {
        fs.txnUpdates.push(d);
        Object.assign(fs.pledge ?? {}, d);
      },
    }),
} as unknown as FirebaseFirestore.Firestore;

import { claimPledgeActivation, activatePledgeAndNotify } from '../activate-pledge';

beforeEach(() => {
  fs.pledge = { pid: 'PLG-1', status: 'started' };
  fs.txnUpdates = [];
  mockEmail.mockReset();
  mockEmail.mockResolvedValue(undefined);
});

describe('claimPledgeActivation', () => {
  it('wins for a started pledge and sets active + activatedAt', async () => {
    expect(await claimPledgeActivation(db, 'PLG-1')).toBe(true);
    expect(fs.txnUpdates.at(-1)!['status']).toBe('active');
    expect(fs.txnUpdates.at(-1)!['activatedAt']).toBeInstanceOf(Date);
  });

  it('LOSES for an already-active pledge, so no second email is sent', async () => {
    fs.pledge!['status'] = 'active';
    expect(await claimPledgeActivation(db, 'PLG-1')).toBe(false);
    expect(fs.txnUpdates).toHaveLength(0);
  });

  it('REFUSES to resurrect a cancelled pledge', async () => {
    // The temple cancelled the real debit in Stripe. If a late finalize or a
    // cron pass flipped this back to active, the portal would tell a family they
    // are giving monthly when the debit is gone - and nobody would look again.
    fs.pledge!['status'] = 'cancelled';
    expect(await claimPledgeActivation(db, 'PLG-1')).toBe(false);
    expect(fs.pledge!['status']).toBe('cancelled');
    expect(fs.txnUpdates).toHaveLength(0);
  });

  it('REFUSES to revive a failed pledge', async () => {
    fs.pledge!['status'] = 'failed';
    expect(await claimPledgeActivation(db, 'PLG-1')).toBe(false);
    expect(fs.txnUpdates).toHaveLength(0);
  });

  it('loses for a pledge that does not exist', async () => {
    fs.pledge = null;
    expect(await claimPledgeActivation(db, 'PLG-GONE')).toBe(false);
  });

  it('only ONE of two concurrent claims wins', async () => {
    // Two callers, one pledge: the returning family and the daily cron.
    const [a, b] = await Promise.all([
      claimPledgeActivation(db, 'PLG-1'),
      claimPledgeActivation(db, 'PLG-1'),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

describe('activatePledgeAndNotify', () => {
  it('mails the family exactly once, on the claim it won', async () => {
    expect(await activatePledgeAndNotify(db, { pid: 'PLG-1', toEmail: 'a@b.com', monthlyAmountCAD: 51 })).toBe(true);
    expect(mockEmail).toHaveBeenCalledTimes(1);
    expect(mockEmail.mock.calls[0]![0]).toMatchObject({ name: 'pledge-activated', to: 'a@b.com' });
  });

  it('sends NOTHING when it lost the claim', async () => {
    fs.pledge!['status'] = 'active';
    expect(await activatePledgeAndNotify(db, { pid: 'PLG-1', toEmail: 'a@b.com', monthlyAmountCAD: 51 })).toBe(false);
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('still activates when there is no email on file', async () => {
    expect(await activatePledgeAndNotify(db, { pid: 'PLG-1', toEmail: null, monthlyAmountCAD: 51 })).toBe(true);
    expect(fs.pledge!['status']).toBe('active');
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('a mail failure does not undo the activation or throw', async () => {
    mockEmail.mockRejectedValue(new Error('SES down'));
    expect(await activatePledgeAndNotify(db, { pid: 'PLG-1', toEmail: 'a@b.com', monthlyAmountCAD: 51 })).toBe(true);
    expect(fs.pledge!['status']).toBe('active');
  });
});
