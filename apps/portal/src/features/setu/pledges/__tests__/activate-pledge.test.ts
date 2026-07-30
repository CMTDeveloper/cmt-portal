import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `claimPledgeTransition` is tested DIRECTLY, not only through `finalizePledge`.
 *
 * That distinction is the whole point: `finalizePledge` returns early for a
 * cancelled or failed pledge, so exercising the claim only through it can never
 * reach the claim's own status guard. The reconciler cron calls this function
 * with whatever it finds in Firestore, so the guard has to hold on its own -
 * a mutation run caught exactly this gap.
 *
 * It now settles BOTH terminal statuses, not just `active`. The `failed` writes
 * used to be bare `ref.update` calls with no compare-and-swap, so a late
 * provider answer could overwrite a pledge another pass had already settled.
 * Every case below is therefore run for both directions.
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

import { claimPledgeTransition, activatePledgeAndNotify } from '../activate-pledge';

beforeEach(() => {
  fs.pledge = { pid: 'PLG-1', status: 'started' };
  fs.txnUpdates = [];
  mockEmail.mockReset();
  mockEmail.mockResolvedValue(undefined);
});

describe('claimPledgeTransition', () => {
  it.each([['active'], ['failed']] as const)('wins for a started pledge and settles it %s', async (to) => {
    expect(await claimPledgeTransition(db, 'PLG-1', to)).toEqual({ won: true, status: to });
    expect(fs.txnUpdates.at(-1)!['status']).toBe(to);
  });

  it('carries the extra fields into the same write', async () => {
    const at = new Date();
    await claimPledgeTransition(db, 'PLG-1', 'active', { activatedAt: at });
    expect(fs.txnUpdates.at(-1)!['activatedAt']).toBe(at);
  });

  it.each([['active'], ['failed']] as const)(
    'REFUSES to relabel a cancelled pledge as %s',
    async (to) => {
      // The temple cancelled the real debit in Stripe. `cancelled` is the
      // temple's decision and `failed` is the provider's verdict - overwriting
      // one with the other destroys the record of which happened and
      // contradicts the audit_log row written alongside it. And flipping it
      // back to active would tell a family they are giving when the debit is
      // gone, which nobody would ever look at again.
      fs.pledge!['status'] = 'cancelled';
      expect(await claimPledgeTransition(db, 'PLG-1', to)).toEqual({ won: false, status: 'cancelled' });
      expect(fs.pledge!['status']).toBe('cancelled');
      expect(fs.txnUpdates).toHaveLength(0);
    },
  );

  it('REFUSES to fail a pledge that already activated, and REPORTS that it is active', async () => {
    // The bug this function was generalized to fix. A late `failed` answer used
    // to overwrite a committed activation - leaving Stripe debiting the family
    // monthly while the portal showed the ask, and (because `failed` does not
    // block a new pledge) offering them a SECOND mandate.
    fs.pledge!['status'] = 'active';
    expect(await claimPledgeTransition(db, 'PLG-1', 'failed')).toEqual({ won: false, status: 'active' });
    expect(fs.pledge!['status']).toBe('active');
    expect(fs.txnUpdates).toHaveLength(0);
  });

  it('REFUSES to revive a failed pledge, and REPORTS that it failed', async () => {
    fs.pledge!['status'] = 'failed';
    expect(await claimPledgeTransition(db, 'PLG-1', 'active')).toEqual({ won: false, status: 'failed' });
    expect(fs.txnUpdates).toHaveLength(0);
  });

  it('loses for a pledge that does not exist, and reports no status', async () => {
    fs.pledge = null;
    expect(await claimPledgeTransition(db, 'PLG-GONE', 'active')).toEqual({ won: false, status: null });
  });

  it('only ONE of two concurrent claims wins', async () => {
    // Two callers, one pledge: the returning family and the daily cron.
    const [a, b] = await Promise.all([
      claimPledgeTransition(db, 'PLG-1', 'active'),
      claimPledgeTransition(db, 'PLG-1', 'active'),
    ]);
    expect([a, b].filter((r) => r.won)).toHaveLength(1);
    // And the loser is told what is actually true, not merely that it lost.
    expect([a, b].every((r) => r.status === 'active')).toBe(true);
  });
});

describe('activatePledgeAndNotify', () => {
  it('mails the family exactly once, on the claim it won', async () => {
    expect(await activatePledgeAndNotify(db, { pid: 'PLG-1', toEmail: 'a@b.com', monthlyAmountCAD: 51 }))
      .toEqual({ won: true, status: 'active' });
    expect(mockEmail).toHaveBeenCalledTimes(1);
    // CMT's template since 2026-07-30, replacing the portal-authored
    // 'pledge-activated'. The DATA KEYS are asserted too: SES renders a blank
    // for an unfilled placeholder and still reports success, so a renamed key
    // would be invisible everywhere except a family's inbox.
    expect(mockEmail.mock.calls[0]![0]).toMatchObject({
      name: 'bv-enrolled-pledge-complete',
      to: 'a@b.com',
      data: { donation_amount: '51' },
    });
  });

  it('never writes an explicit undefined, which real Firestore REJECTS', async () => {
    // This harness's `Object.assign` happily stores `undefined`; Firestore
    // throws "Cannot use undefined as a Firestore value" and the activation
    // write fails outright. So the mock is MORE PERMISSIVE than production, and
    // a test that only checked the write "succeeded" would prove nothing -
    // assert the payload shape instead.
    //
    // Found by a mutation making the optional field's spread unconditional,
    // which every behavioural test passed.
    await activatePledgeAndNotify(db, { pid: 'PLG-1', toEmail: null, monthlyAmountCAD: 51 });
    const written = fs.txnUpdates.at(-1)!;
    expect(Object.values(written).every((v) => v !== undefined)).toBe(true);
    expect('verifiedSubscriptionId' in written, 'an absent optional was written as a key').toBe(false);
  });

  it('records the verified subscription when the caller names one', async () => {
    await activatePledgeAndNotify(db, {
      pid: 'PLG-1', toEmail: null, monthlyAmountCAD: 51, verifiedSubscriptionId: 'sub_X',
    });
    expect(fs.txnUpdates.at(-1)!['verifiedSubscriptionId']).toBe('sub_X');
  });

  it('sends NOTHING when it lost the claim', async () => {
    fs.pledge!['status'] = 'active';
    expect(await activatePledgeAndNotify(db, { pid: 'PLG-1', toEmail: 'a@b.com', monthlyAmountCAD: 51 }))
      .toEqual({ won: false, status: 'active' });
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('still activates when there is no email on file', async () => {
    expect((await activatePledgeAndNotify(db, { pid: 'PLG-1', toEmail: null, monthlyAmountCAD: 51 })).won).toBe(true);
    expect(fs.pledge!['status']).toBe('active');
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('a mail failure does not undo the activation or throw', async () => {
    mockEmail.mockRejectedValue(new Error('SES down'));
    expect((await activatePledgeAndNotify(db, { pid: 'PLG-1', toEmail: 'a@b.com', monthlyAmountCAD: 51 })).won).toBe(true);
    expect(fs.pledge!['status']).toBe('active');
  });
});
