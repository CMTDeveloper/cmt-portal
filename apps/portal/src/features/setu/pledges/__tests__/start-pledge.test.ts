import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Starting a pledge is the one place a family can create a recurring financial
 * commitment, so the tests below are weighted toward what must NOT happen:
 * two live pledges, a duplicate created by a double-click, or a doc left saying
 * `started` when the provider call never succeeded.
 */

type Doc = Record<string, unknown> & { id: string };
const { fs } = vi.hoisted(() => ({
  fs: { docs: [] as Doc[], created: [] as Doc[], updates: [] as Array<{ id: string; data: Record<string, unknown> }>, txnRuns: 0 },
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: (name: string) => ({
      where: (field: string, _op: string, value: unknown) => ({
        __query: { name, field, value },
      }),
      doc: (id?: string) => ({
        id: id ?? `PLG-${fs.docs.length + fs.created.length + 1}`,
        get: async () => {
          const d = fs.docs.find((x) => x.id === id);
          return { exists: d !== undefined, id, data: () => d };
        },
        set: async (data: Record<string, unknown>) => { fs.updates.push({ id: id ?? '?', data }); },
        update: async (data: Record<string, unknown>) => { fs.updates.push({ id: id ?? '?', data }); },
      }),
    }),
    runTransaction: async (fn: (t: unknown) => Promise<unknown>) => {
      fs.txnRuns++;
      const txn = {
        get: async (q: { __query?: { value: unknown } }) => ({
          docs: fs.docs
            .filter((d) => !q.__query || d['fid'] === q.__query.value)
            .map((d) => ({ id: d.id, data: () => d })),
        }),
        create: (ref: { id: string }, data: Record<string, unknown>) => {
          fs.created.push({ id: ref.id, ...data });
        },
        set: (ref: { id: string }, data: Record<string, unknown>) => {
          fs.created.push({ id: ref.id, ...data });
        },
      };
      return fn(txn);
    },
  }),
}));

const { mockSetupLink } = vi.hoisted(() => ({ mockSetupLink: vi.fn() }));
vi.mock('../stripe-pad-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createPadSetupLink: mockSetupLink,
}));

import { startPledge } from '../start-pledge';

beforeEach(() => {
  fs.docs = [];
  fs.created = [];
  fs.updates = [];
  fs.txnRuns = 0;
  mockSetupLink.mockReset();
  mockSetupLink.mockResolvedValue({ checkoutUrl: 'https://stripe.test/cs_1', sessionId: 'cs_1', customerId: 'cus_1' });
  process.env.PLEDGE_MONTHLY_AMOUNT_CAD = '51';
});

const who = { fid: 'CMT-A', mid: 'CMT-A-01', email: 'a@b.com', name: 'Asha Apple' };

describe('startPledge', () => {
  it('creates a started pledge and returns the hosted url', async () => {
    const out = await startPledge(who);
    expect(out.created).toBe(true);
    if (!out.created) throw new Error('unreachable');
    expect(out.checkoutUrl).toBe('https://stripe.test/cs_1');

    const doc = fs.created[0]!;
    expect(doc['status']).toBe('started');
    expect(doc['fid']).toBe('CMT-A');
    expect(doc['startedByMid']).toBe('CMT-A-01');
    // Snapshotted, so a later price change never rewrites this pledge.
    expect(doc['monthlyAmountCAD']).toBe(51);
    // The handles arrive from the provider AFTER the doc exists.
    expect(doc['setupSessionId'] ?? null).toBeNull();
  });

  it('stores the provider handles after the call succeeds', async () => {
    await startPledge(who);
    const patch = fs.updates.at(-1)!.data;
    expect(patch['setupSessionId']).toBe('cs_1');
    expect(patch['customerId']).toBe('cus_1');
  });

  it('writes NOTHING bank-ish into the doc', async () => {
    mockSetupLink.mockResolvedValue({
      checkoutUrl: 'u', sessionId: 'cs_1', customerId: 'cus_1',
      // A provider response that carries more than we asked for. Spreading it
      // would be the accident this guards.
      accountNumber: '000123456789', last4: '6789',
    });
    await startPledge(who);
    const all = JSON.stringify([...fs.created, ...fs.updates]).toLowerCase();
    for (const forbidden of ['accountnumber', 'last4', 'transit', 'institution']) {
      expect(all, `${forbidden} must never be persisted`).not.toContain(forbidden);
    }
  });

  it('does NOT create a second pledge while one is already started', async () => {
    fs.docs = [{ id: 'PLG-EXISTING', fid: 'CMT-A', status: 'started' }];
    const out = await startPledge(who);
    expect(out.created).toBe(false);
    if (out.created) throw new Error('unreachable');
    expect(out.reason).toBe('already-started');
    expect(fs.created).toHaveLength(0);
    // And it never reached the provider - a second hosted session for a family
    // mid-flow is how two mandates get authorised.
    expect(mockSetupLink).not.toHaveBeenCalled();
  });

  it('does NOT create a second pledge while one is already active', async () => {
    fs.docs = [{ id: 'PLG-LIVE', fid: 'CMT-A', status: 'active' }];
    const out = await startPledge(who);
    expect(out.created).toBe(false);
    if (out.created) throw new Error('unreachable');
    expect(out.reason).toBe('already-active');
    expect(mockSetupLink).not.toHaveBeenCalled();
  });

  it('DOES allow a fresh start after a failed or cancelled pledge', async () => {
    // Otherwise one bad attempt locks a family out of giving forever.
    fs.docs = [
      { id: 'PLG-OLD1', fid: 'CMT-A', status: 'failed' },
      { id: 'PLG-OLD2', fid: 'CMT-A', status: 'cancelled' },
    ];
    const out = await startPledge(who);
    expect(out.created).toBe(true);
    expect(fs.created).toHaveLength(1);
  });

  it('ignores ANOTHER family\'s live pledge', async () => {
    fs.docs = [{ id: 'PLG-OTHER', fid: 'CMT-ZZZ', status: 'active' }];
    const out = await startPledge(who);
    expect(out.created).toBe(true);
  });

  it('takes the duplicate decision inside a TRANSACTION', async () => {
    // A double-click is two concurrent requests. Deciding outside a transaction
    // lets both read "no pledge" and both create one.
    await startPledge(who);
    expect(fs.txnRuns).toBe(1);
  });

  it('marks the pledge failed when the provider call throws, so the family can retry', async () => {
    mockSetupLink.mockRejectedValue(new Error('upstream 502'));
    await expect(startPledge(who)).rejects.toThrow();
    // Left as `started` it would block every future attempt (the guard above)
    // AND claim to the family that something is in flight when nothing is.
    const patch = fs.updates.at(-1)!.data;
    expect(patch['status']).toBe('failed');
    expect(String(patch['lastError'])).toContain('upstream 502');
  });

  it('never calls the provider before the doc exists', async () => {
    // Ordering matters: a hosted session minted before we have a pid cannot be
    // reconciled if the write then fails - a true orphan with nothing pointing
    // at it.
    const order: string[] = [];
    mockSetupLink.mockImplementation(async () => {
      order.push('provider');
      return { checkoutUrl: 'u', sessionId: 'cs_1', customerId: null };
    });
    await startPledge(who);
    expect(order).toEqual(['provider']);
    expect(fs.created).toHaveLength(1);
  });
});
