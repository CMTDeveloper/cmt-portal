import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdvancePledgeDoc } from '../advance-pledge';

/**
 * The shared steps 3→4→5 state machine, tested for CONCURRENCY specifically.
 *
 * Two independent callers drive it: the family returning from the hosted page
 * (`finalizePledge`) and the daily reconciler cron. Both load the pledge, then
 * ask the provider, then write. A race is therefore not exotic here - it is the
 * ordinary shape of the system, and the code's own comments say so.
 *
 * A race means BOTH callers hold a snapshot taken before either wrote. That is
 * exactly what these tests model: one `stale` object passed to two calls. No
 * deferred promises, no timing luck - the interleaving is the fixture.
 */

type Doc = Record<string, unknown>;
const { fs } = vi.hoisted(() => ({
  fs: { pledge: null as Doc | null, updates: [] as Doc[] },
}));

const { mockStep3, mockStep4, mockStep5, mockEmail } = vi.hoisted(() => ({
  mockStep3: vi.fn(), mockStep4: vi.fn(), mockStep5: vi.fn(), mockEmail: vi.fn(),
}));
vi.mock('../stripe-pad-client', () => ({
  getCheckoutSessionResult: mockStep3,
  createMonthlySubscription: mockStep4,
  getSubscriptionResult: mockStep5,
}));
vi.mock('@/lib/aws/send-managed-email', () => ({ sendManagedEmail: mockEmail }));

const ref = {
  id: 'PLG-1',
  update: async (d: Doc) => {
    fs.updates.push(d);
    Object.assign(fs.pledge ?? {}, d);
  },
} as unknown as FirebaseFirestore.DocumentReference;

const db = {
  collection: () => ({
    doc: () => ({
      get: async () => ({ exists: true, data: () => ({ managers: ['CMT-A-01'] }) }),
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: true, data: () => ({ email: 'a@b.com' }) }) }),
      }),
    }),
  }),
  runTransaction: async (fn: (t: unknown) => Promise<unknown>) =>
    fn({
      // Reads the LIVE object, which is what makes the compare-and-swap real:
      // the second caller's transaction sees what the first one wrote.
      get: async () => ({ exists: fs.pledge !== null, data: () => fs.pledge }),
      update: (_r: unknown, d: Doc) => {
        fs.updates.push(d);
        Object.assign(fs.pledge ?? {}, d);
      },
    }),
} as unknown as FirebaseFirestore.Firestore;

import { advancePledge } from '../advance-pledge';

/** The snapshot BOTH racing callers loaded, before either of them wrote. */
function staleSnapshot(): AdvancePledgeDoc {
  return { fid: 'CMT-A', status: 'started', setupSessionId: 'cs_1', subscriptionId: 'sub_1', monthlyAmountCAD: 51 };
}

beforeEach(() => {
  fs.pledge = { pid: 'PLG-1', fid: 'CMT-A', status: 'started', setupSessionId: 'cs_1', subscriptionId: 'sub_1', monthlyAmountCAD: 51 };
  fs.updates = [];
  mockStep3.mockReset(); mockStep4.mockReset(); mockStep5.mockReset(); mockEmail.mockReset();
  mockStep3.mockResolvedValue('success');
  mockStep4.mockResolvedValue({ subscriptionId: 'sub_1', status: 'active', customerId: 'cus_1' });
  mockStep5.mockResolvedValue('success');
  mockEmail.mockResolvedValue(undefined);
});

describe('advancePledge - a late answer must never stomp a settled pledge', () => {
  it('a LATE `failed` does not overwrite an activation that already committed', async () => {
    // The provider answered `success` to the first read and `failed` to the
    // second. Real payment rails do this - a subscription can read active and
    // then flip - and two near-simultaneous reads are exactly what a returning
    // browser plus the cron produce.
    mockStep5.mockResolvedValueOnce('success').mockResolvedValueOnce('failed');

    const first = await advancePledge(db, ref, staleSnapshot(), 'PLG-1');
    const second = await advancePledge(db, ref, staleSnapshot(), 'PLG-1');

    expect(first).toBe('active');
    // The money IS moving. Anything else here is the portal lying about a live
    // debit - and worse than a display bug: `failed` does NOT block a new
    // pledge (start-pledge.ts LIVE_STATUSES), so the family would be offered a
    // SECOND monthly mandate while the first is still charging them.
    expect(fs.pledge!['status'], 'a late provider answer overwrote a committed activation').toBe('active');
    expect(second, 'the late caller reported a state that contradicts the record').toBe('active');
  });

  it('a LATE `success` does not resurrect a pledge that already failed', async () => {
    mockStep5.mockResolvedValueOnce('failed').mockResolvedValueOnce('success');

    const first = await advancePledge(db, ref, staleSnapshot(), 'PLG-1');
    const second = await advancePledge(db, ref, staleSnapshot(), 'PLG-1');

    expect(first).toBe('failed');
    expect(fs.pledge!['status']).toBe('failed');
    expect(second).toBe('failed');
    // And above all: no email. A family whose mandate failed must not be told
    // their monthly gift is set up.
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('never mails the family twice when both callers see success', async () => {
    const first = await advancePledge(db, ref, staleSnapshot(), 'PLG-1');
    const second = await advancePledge(db, ref, staleSnapshot(), 'PLG-1');
    expect([first, second]).toEqual(['active', 'active']);
    expect(mockEmail).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a pledge the temple cancelled mid-flight', async () => {
    // An admin cancels between the caller loading the doc and the provider
    // answering. `cancelled` is the temple's decision and `failed` is the
    // provider's verdict - overwriting one with the other destroys the only
    // record of which happened, and contradicts the audit_log row.
    mockStep5.mockImplementation(async () => {
      fs.pledge!['status'] = 'cancelled';
      return 'failed';
    });
    const out = await advancePledge(db, ref, staleSnapshot(), 'PLG-1');
    expect(fs.pledge!['status']).toBe('cancelled');
    expect(out).toBe('failed');
  });

  it('does not fail a pledge that was cancelled before a missing-session write', async () => {
    // The `no setup session` path writes `failed` too, and had the same hole.
    fs.pledge!['status'] = 'cancelled';
    const out = await advancePledge(db, ref, { ...staleSnapshot(), setupSessionId: null }, 'PLG-1');
    expect(fs.pledge!['status']).toBe('cancelled');
    expect(out).toBe('failed');
  });

  it('reports UNRESOLVED, not failed, when the document vanishes mid-flight', async () => {
    // The one reachable way outcomeOf() sees a null status. `started` cannot
    // reach it - a `started` pledge wins the claim by definition - so this is
    // the whole of that branch, and a mutation run found it untested.
    //
    // `failed` would be the wrong answer: there is nothing to have failed. The
    // record is gone, and telling a family their monthly gift failed on the
    // strength of a missing document is a claim about their money we cannot
    // support. `processing` says "we do not know", which is true.
    mockStep5.mockImplementation(async () => { fs.pledge = null; return 'success'; });
    expect(await advancePledge(db, ref, staleSnapshot(), 'PLG-1')).toBe('processing');
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('does not fail a pledge that activated before a mandate-failed write', async () => {
    // Step 3's `failed` write had the hole as well - all three needed guarding,
    // not just the one a single reproduction happened to reach.
    fs.pledge!['status'] = 'active';
    mockStep3.mockResolvedValue('failed');
    const out = await advancePledge(db, ref, { ...staleSnapshot(), subscriptionId: null }, 'PLG-1');
    expect(fs.pledge!['status']).toBe('active');
    expect(out).toBe('active');
  });
});
