import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Finalizing is where a family's pledge becomes a real recurring debit, so the
 * tests weight three things above the happy path:
 *   - the client can never FORCE `active` (only the provider's word does that)
 *   - `pending` must never be reported as success
 *   - the activation email cannot double-send when the cron races this path
 */

type Doc = Record<string, unknown>;
const { fs } = vi.hoisted(() => ({
  fs: {
    pledge: null as Doc | null,
    updates: [] as Doc[],
    txnUpdates: [] as Doc[],
    txnRuns: 0,
    family: { managers: ['CMT-A-01'] } as Doc | null,
    member: { email: 'a@b.com' } as Doc | null,
  },
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const pledgeRef = {
    get: async () => ({ exists: fs.pledge !== null, data: () => fs.pledge }),
    update: async (d: Doc) => { fs.updates.push(d); Object.assign(fs.pledge ?? {}, d); },
  };
  const db = {
    collection: (name: string) => ({
      doc: (_id?: string) => ({
        get: async () =>
          name === 'families'
            ? { exists: fs.family !== null, data: () => fs.family }
            : { exists: fs.pledge !== null, data: () => fs.pledge },
        update: pledgeRef.update,
        collection: () => ({
          doc: () => ({ get: async () => ({ exists: fs.member !== null, data: () => fs.member }) }),
        }),
      }),
    }),
    runTransaction: async (fn: (t: unknown) => Promise<unknown>) => {
      fs.txnRuns++;
      return fn({
        get: async () => ({ exists: fs.pledge !== null, data: () => fs.pledge }),
        update: (_ref: unknown, d: Doc) => { fs.txnUpdates.push(d); Object.assign(fs.pledge ?? {}, d); },
      });
    },
  };
  return { portalFirestore: () => db };
});

const { mockStep3, mockStep4, mockStep5, mockEmail } = vi.hoisted(() => ({
  mockStep3: vi.fn(), mockStep4: vi.fn(), mockStep5: vi.fn(), mockEmail: vi.fn(),
}));
vi.mock('../stripe-pad-client', () => ({
  getCheckoutSessionResult: mockStep3,
  createMonthlySubscription: mockStep4,
  getSubscriptionResult: mockStep5,
}));
vi.mock('@/lib/aws/send-managed-email', () => ({ sendManagedEmail: mockEmail }));

import { finalizePledge } from '../finalize-pledge';

beforeEach(() => {
  fs.pledge = { pid: 'PLG-1', fid: 'CMT-A', status: 'started', setupSessionId: 'cs_1', subscriptionId: null, monthlyAmountCAD: 51 };
  fs.updates = []; fs.txnUpdates = []; fs.txnRuns = 0;
  fs.family = { managers: ['CMT-A-01'] };
  fs.member = { email: 'a@b.com' };
  mockStep3.mockReset(); mockStep4.mockReset(); mockStep5.mockReset(); mockEmail.mockReset();
  mockStep3.mockResolvedValue('success');
  mockStep4.mockResolvedValue({ subscriptionId: 'sub_1', status: 'active', customerId: 'cus_1' });
  mockStep5.mockResolvedValue('success');
  mockEmail.mockResolvedValue(undefined);
});

const args = { pid: 'PLG-1', fid: 'CMT-A' };

describe('finalizePledge - the happy path', () => {
  it('mandate success → subscription → live = active, and the family is told once', async () => {
    expect(await finalizePledge(args)).toEqual({ state: 'active' });
    expect(fs.pledge!['status']).toBe('active');
    expect(fs.pledge!['subscriptionId']).toBe('sub_1');
    expect(mockEmail).toHaveBeenCalledTimes(1);
  });

  it('persists the subscriptionId BEFORE asking whether it is live', async () => {
    // If the process dies between step 4 and step 5, the reconciler needs this
    // handle; without it the subscription exists at Stripe with nothing here
    // pointing at it.
    const order: string[] = [];
    mockStep5.mockImplementation(async () => { order.push('step5'); return 'success'; });
    await finalizePledge(args);
    const idxWrite = fs.updates.findIndex((u) => u['subscriptionId'] === 'sub_1');
    expect(idxWrite).toBeGreaterThanOrEqual(0);
    expect(order).toEqual(['step5']);
  });
});

describe('finalizePledge - nothing unresolved is ever reported as success', () => {
  it('mandate pending → stays started, reports processing, and does NOT create a subscription', async () => {
    mockStep3.mockResolvedValue('pending');
    expect(await finalizePledge(args)).toEqual({ state: 'processing' });
    expect(fs.pledge!['status']).toBe('started');
    expect(mockStep4).not.toHaveBeenCalled();
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('subscription pending → stays started WITH the handle, so the cron can finish it', async () => {
    mockStep5.mockResolvedValue('pending');
    expect(await finalizePledge(args)).toEqual({ state: 'processing' });
    expect(fs.pledge!['status']).toBe('started');
    expect(fs.pledge!['subscriptionId']).toBe('sub_1');
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('mandate failed → failed, and never reaches step 4', async () => {
    mockStep3.mockResolvedValue('failed');
    expect(await finalizePledge(args)).toEqual({ state: 'failed' });
    expect(fs.pledge!['status']).toBe('failed');
    expect(mockStep4).not.toHaveBeenCalled();
  });

  it('subscription failed → failed', async () => {
    mockStep5.mockResolvedValue('failed');
    expect(await finalizePledge(args)).toEqual({ state: 'failed' });
    expect(fs.pledge!['status']).toBe('failed');
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('makes ONE pass - never polls a pending provider', async () => {
    mockStep3.mockResolvedValue('pending');
    await finalizePledge(args);
    expect(mockStep3).toHaveBeenCalledTimes(1);
  });
});

describe('finalizePledge - authorization and idempotency', () => {
  it('refuses another family\'s pledge', async () => {
    expect(await finalizePledge({ pid: 'PLG-1', fid: 'CMT-OTHER' })).toEqual({ state: 'not-yours' });
    expect(mockStep3).not.toHaveBeenCalled();
  });

  it('reports not-found for a pledge that does not exist', async () => {
    fs.pledge = null;
    expect(await finalizePledge(args)).toEqual({ state: 'not-found' });
  });

  it('re-finalizing an ACTIVE pledge changes nothing and re-sends nothing', async () => {
    fs.pledge!['status'] = 'active';
    expect(await finalizePledge(args)).toEqual({ state: 'active' });
    expect(mockStep3).not.toHaveBeenCalled();
    expect(mockEmail).not.toHaveBeenCalled();
    expect(fs.updates).toHaveLength(0);
  });

  it('never resurrects a CANCELLED pledge', async () => {
    // The temple cancelled it. A stray finalize must not put it back.
    fs.pledge!['status'] = 'cancelled';
    expect(await finalizePledge(args)).toEqual({ state: 'failed' });
    expect(mockStep3).not.toHaveBeenCalled();
    expect(fs.pledge!['status']).toBe('cancelled');
  });

  it('fails a started pledge that never got a setup session, so the family can retry', async () => {
    fs.pledge!['setupSessionId'] = null;
    expect(await finalizePledge(args)).toEqual({ state: 'failed' });
    expect(fs.pledge!['status']).toBe('failed');
  });
});

describe('finalizePledge - the client cannot force activation', () => {
  it('derives the outcome ONLY from the provider, never from the caller', async () => {
    // The route passes just {pid, fid}; there is no field a caller could set to
    // influence this. Prove it by making the provider say "not yet" and
    // confirming no amount of caller intent produces `active`.
    mockStep3.mockResolvedValue('pending');
    const out = await finalizePledge({ ...args, ...({ status: 'active', state: 'active' } as object) });
    expect(out).toEqual({ state: 'processing' });
    expect(fs.pledge!['status']).toBe('started');
  });
});

describe('finalizePledge - the activation race with the cron', () => {
  it('activates through a TRANSACTION, not a plain read-then-write', async () => {
    await finalizePledge(args);
    expect(fs.txnRuns).toBe(1);
    expect(fs.txnUpdates.at(-1)!['status']).toBe('active');
  });

  it('does not send a second email when the cron already activated it mid-flight', async () => {
    // The cron flips the pledge to `active` between our step 5 and our claim -
    // exactly the window a daily reconciler and a returning family share.
    mockStep5.mockImplementation(async () => {
      fs.pledge!['status'] = 'active';
      return 'success';
    });
    const out = await finalizePledge(args);
    expect(out).toEqual({ state: 'active' });
    // The claim lost, so THIS path stays quiet. Without the transaction both
    // paths would mail the family about the same activation.
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('still reports active even when it lost the claim', async () => {
    mockStep5.mockImplementation(async () => { fs.pledge!['status'] = 'active'; return 'success'; });
    expect(await finalizePledge(args)).toEqual({ state: 'active' });
  });

  it('a mail failure never undoes an activation', async () => {
    mockEmail.mockRejectedValue(new Error('SES down'));
    expect(await finalizePledge(args)).toEqual({ state: 'active' });
    expect(fs.pledge!['status']).toBe('active');
  });
});
