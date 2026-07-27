import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cancelling a pledge in the portal is BOOKKEEPING ONLY.
 *
 * The temple stops the actual debit MANUALLY in Stripe (Vaibhav 2026-07-26) -
 * there is no cancel endpoint on the payment service and the portal cannot stop
 * a debit. So the single most important assertion in this file is the negative
 * one: this code path must never call the provider, because a caller who
 * believed it did would leave a family being charged.
 */

type Doc = Record<string, unknown>;
const { fs } = vi.hoisted(() => ({
  fs: {
    pledge: null as Doc | null,
    txnUpdates: [] as Doc[],
    auditRows: [] as Doc[],
    txnRuns: 0,
  },
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  portalFirestore: () => ({
    collection: (name: string) => ({
      doc: (id?: string) => ({ id: id ?? `${name}-auto`, __col: name }),
    }),
    runTransaction: async (fn: (t: unknown) => Promise<unknown>) => {
      fs.txnRuns++;
      return fn({
        get: async () => ({ exists: fs.pledge !== null, data: () => fs.pledge }),
        update: (_ref: unknown, d: Doc) => {
          fs.txnUpdates.push(d);
          Object.assign(fs.pledge ?? {}, d);
        },
        set: (ref: { __col: string }, d: Doc) => {
          if (ref.__col === 'audit_log') fs.auditRows.push(d);
        },
      });
    },
  }),
}));

// Mocked so the test can prove NOTHING here reaches the provider.
const { mockStep3, mockStep4, mockStep5 } = vi.hoisted(() => ({
  mockStep3: vi.fn(), mockStep4: vi.fn(), mockStep5: vi.fn(),
}));
vi.mock('../stripe-pad-client', () => ({
  getCheckoutSessionResult: mockStep3,
  createMonthlySubscription: mockStep4,
  getSubscriptionResult: mockStep5,
}));

import { cancelPledgeRecord } from '../cancel-pledge';

const ACTOR = {
  uid: 'uid-admin',
  mid: 'CMT-Z-01',
  role: 'admin',
  extraRoles: ['welcome-team'],
};

beforeEach(() => {
  fs.pledge = { pid: 'PLG-1', fid: 'CMT-A', status: 'active', monthlyAmountCAD: 51 };
  fs.txnUpdates = []; fs.auditRows = []; fs.txnRuns = 0;
  mockStep3.mockReset(); mockStep4.mockReset(); mockStep5.mockReset();
});

describe('cancelPledgeRecord', () => {
  it('marks the record cancelled and stamps when', async () => {
    expect(await cancelPledgeRecord({ pid: 'PLG-1', actor: ACTOR })).toEqual({ ok: true });
    expect(fs.pledge!['status']).toBe('cancelled');
    expect(fs.txnUpdates.at(-1)!['cancelledAt']).toBeInstanceOf(Date);
  });

  it('NEVER calls the payment service - the temple stops the debit in Stripe', async () => {
    // The whole reason this function exists as bookkeeping. If it ever gained a
    // provider call, the screen's warning copy would become a lie in the other
    // direction and nobody would notice until a family complained.
    await cancelPledgeRecord({ pid: 'PLG-1', actor: ACTOR });
    expect(mockStep3).not.toHaveBeenCalled();
    expect(mockStep4).not.toHaveBeenCalled();
    expect(mockStep5).not.toHaveBeenCalled();
  });

  it('writes the audit row in the SAME transaction as the status change', async () => {
    await cancelPledgeRecord({ pid: 'PLG-1', actor: ACTOR });
    expect(fs.txnRuns).toBe(1);
    expect(fs.auditRows).toHaveLength(1);
    expect(fs.auditRows[0]).toMatchObject({
      actorUid: 'uid-admin',
      actorMid: 'CMT-Z-01',
      action: 'pledge.cancel',
      fid: 'CMT-A',
    });
  });

  it('records the actor\'s OTHER roles, not just the primary one', async () => {
    // A row naming only the primary role reads as the wrong person having acted.
    // Same reason the staff-edit audit carries extraRoles.
    await cancelPledgeRecord({ pid: 'PLG-1', actor: ACTOR });
    expect(fs.auditRows[0]!['actorExtraRoles']).toEqual(['welcome-team']);
  });

  it('records what the status WAS, so the row survives without the pledge', async () => {
    await cancelPledgeRecord({ pid: 'PLG-1', actor: ACTOR });
    expect(fs.auditRows[0]).toMatchObject({ before: { status: 'active' }, after: { status: 'cancelled' } });
  });

  it('cancels a pledge that is still only started', async () => {
    // The orphan case: staff gave up on a mandate that never confirmed. Blocking
    // this would leave the family unable to start a new one, since `started`
    // blocks a new pledge.
    fs.pledge = { pid: 'PLG-1', fid: 'CMT-A', status: 'started' };
    expect(await cancelPledgeRecord({ pid: 'PLG-1', actor: ACTOR })).toEqual({ ok: true });
    expect(fs.pledge!['status']).toBe('cancelled');
  });

  it('reports not-found for a pledge that does not exist, writing nothing', async () => {
    fs.pledge = null;
    expect(await cancelPledgeRecord({ pid: 'GONE', actor: ACTOR })).toEqual({ ok: false, reason: 'not-found' });
    expect(fs.auditRows).toHaveLength(0);
    expect(fs.txnUpdates).toHaveLength(0);
  });

  it('is idempotent: cancelling an already-cancelled pledge writes no second audit row', async () => {
    // A double-click must not produce two rows saying two people cancelled the
    // same thing, nor overwrite the original cancellation timestamp.
    fs.pledge = { pid: 'PLG-1', fid: 'CMT-A', status: 'cancelled' };
    expect(await cancelPledgeRecord({ pid: 'PLG-1', actor: ACTOR })).toEqual({ ok: false, reason: 'already-cancelled' });
    expect(fs.auditRows).toHaveLength(0);
    expect(fs.txnUpdates).toHaveLength(0);
  });

  it('refuses a failed pledge rather than relabelling it', async () => {
    // `failed` and `cancelled` mean different things - one is the provider's
    // verdict, the other the temple's decision. Overwriting one with the other
    // destroys the only record of which happened.
    fs.pledge = { pid: 'PLG-1', fid: 'CMT-A', status: 'failed' };
    expect(await cancelPledgeRecord({ pid: 'PLG-1', actor: ACTOR })).toEqual({ ok: false, reason: 'not-cancellable' });
    expect(fs.txnUpdates).toHaveLength(0);
  });
});
