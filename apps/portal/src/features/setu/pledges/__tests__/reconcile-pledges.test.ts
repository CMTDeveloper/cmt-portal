import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The reconciler is the task that makes this feature correct rather than a demo.
 *
 * The failure it exists for: step 4 is a SECOND server call. If the browser dies
 * between the mandate confirming and the subscription being created, the family
 * has a live mandate at Stripe, no subscription, no money moving - and they
 * believe they are giving monthly. Nothing else in the system notices.
 *
 * So the tests below weight three things above the happy path:
 *   - the orphan is actually repaired, with the SAME setupSessionId
 *   - one family's provider error never costs another family their pass
 *   - a settled pledge is never touched, and never re-announced
 */

type Doc = Record<string, unknown> & { id: string };
const { fs } = vi.hoisted(() => ({
  fs: {
    docs: [] as Doc[],
    updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
    queries: [] as string[],
    throwOnField: null as string | null,
    family: { managers: ['CMT-A-01'] } as Record<string, unknown> | null,
    member: { email: 'a@b.com' } as Record<string, unknown> | null,
  },
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  function pledgeDoc(id: string) {
    return {
      id,
      get: async () => {
        const d = fs.docs.find((x) => x.id === id);
        return { exists: d !== undefined, id, data: () => d };
      },
      update: async (data: Record<string, unknown>) => {
        fs.updates.push({ id, data });
        const d = fs.docs.find((x) => x.id === id);
        if (d) Object.assign(d, data);
      },
    };
  }
  const db = {
    collection: (name: string) => {
      if (name === 'families') {
        return {
          doc: () => ({
            get: async () => ({ exists: fs.family !== null, data: () => fs.family }),
            collection: () => ({
              doc: () => ({ get: async () => ({ exists: fs.member !== null, data: () => fs.member }) }),
            }),
          }),
        };
      }
      return {
        doc: (id: string) => pledgeDoc(id),
        where: (field: string, op: string, value: unknown) => {
          fs.queries.push(`${field}${op}${String(value)}`);
          return {
            get: async () => {
              // Keyed on the FIELD so a test can break the secondary query
              // without breaking the reconciliation it must not be able to cost.
              if (fs.throwOnField === field) throw new Error('FAILED_PRECONDITION');
              return {
                docs: fs.docs.filter((d) => d[field] === value).map((d) => ({ id: d.id, data: () => d })),
              };
            },
          };
        },
      };
    },
    runTransaction: async (fn: (t: unknown) => Promise<unknown>) =>
      fn({
        get: async (ref: { id: string }) => {
          const d = fs.docs.find((x) => x.id === ref.id);
          return { exists: d !== undefined, data: () => d };
        },
        update: (ref: { id: string }, data: Record<string, unknown>) => {
          fs.updates.push({ id: ref.id, data });
          const d = fs.docs.find((x) => x.id === ref.id);
          if (d) Object.assign(d, data);
        },
      }),
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

import { reconcilePledges, STALE_AFTER_DAYS } from '../reconcile-pledges';

const NOW = new Date('2026-03-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

/** A pledge whose browser died between the mandate and the subscription. */
function orphan(id: string, over: Partial<Doc> = {}): Doc {
  return {
    id, fid: `CMT-${id}`, status: 'started', monthlyAmountCAD: 51,
    setupSessionId: `cs_${id}`, subscriptionId: null,
    startedAt: { toDate: () => daysAgo(1) },
    ...over,
  } as Doc;
}

beforeEach(() => {
  fs.docs = []; fs.updates = []; fs.queries = []; fs.throwOnField = null;
  fs.family = { managers: ['CMT-A-01'] };
  fs.member = { email: 'a@b.com' };
  mockStep3.mockReset(); mockStep4.mockReset(); mockStep5.mockReset(); mockEmail.mockReset();
  mockStep3.mockResolvedValue('success');
  mockStep4.mockResolvedValue({ subscriptionId: 'sub_new', status: 'active', customerId: 'cus_1' });
  mockStep5.mockResolvedValue('success');
  mockEmail.mockResolvedValue(undefined);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe('reconcilePledges - the query', () => {
  it('scans ONLY started pledges, with a single-field equality', async () => {
    await reconcilePledges();
    // TWO queries, each a SINGLE-FIELD equality. Neither combines a `where`
    // with an `orderBy` or a second `where`, so neither needs a composite index
    // that firestore.indexes.json does not declare - and this suite is
    // index-blind, so a FAILED_PRECONDITION would only appear in production.
    // The stale report deliberately does NOT add a `startedAt` range: it
    // filters in memory over rows this scan already loaded.
    expect(fs.queries).toEqual(['status==started', 'needsStripeVerification==true']);
  });
});

describe('reconcilePledges - the orphan mandate', () => {
  it('repairs it: asks about the mandate, then creates the subscription with the SAME session', async () => {
    fs.docs = [orphan('PLG-1')];
    const out = await reconcilePledges();

    expect(mockStep3).toHaveBeenCalledWith('cs_PLG-1');
    // The SAME setupSessionId, and the pid - from which the client derives a
    // deterministic idempotency key, so a retry resumes rather than creating a
    // second subscription at the family's bank.
    expect(mockStep4).toHaveBeenCalledWith({ setupSessionId: 'cs_PLG-1', pid: 'PLG-1' });
    expect(out.activated).toBe(1);
    expect(fs.docs[0]!['status']).toBe('active');
  });

  it('persists the subscriptionId BEFORE deciding it is live', async () => {
    // If the run dies between step 4 and step 5, the subscription exists at
    // Stripe with nothing here pointing at it - unfindable by a later pass.
    fs.docs = [orphan('PLG-1')];
    await reconcilePledges();
    const subWrite = fs.updates.findIndex((u) => u.data['subscriptionId'] === 'sub_new');
    const activation = fs.updates.findIndex((u) => u.data['status'] === 'active');
    expect(subWrite).toBeGreaterThan(-1);
    expect(subWrite).toBeLessThan(activation);
  });

  it('tells the family exactly once, through the shared activation claim', async () => {
    fs.docs = [orphan('PLG-1')];
    await reconcilePledges();
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

  it('does NOT re-run step 3 for a pledge that already has a subscription', async () => {
    // It got past step 4 last time; asking about the mandate again is a wasted
    // provider call, and re-running step 4 would be worse.
    fs.docs = [orphan('PLG-1', { subscriptionId: 'sub_existing' })];
    await reconcilePledges();
    expect(mockStep3).not.toHaveBeenCalled();
    expect(mockStep4).not.toHaveBeenCalled();
    expect(mockStep5).toHaveBeenCalledWith('sub_existing');
  });
});

describe('reconcilePledges - what it must not touch', () => {
  it('leaves a pledge still pending at the provider as started', async () => {
    mockStep3.mockResolvedValue('pending');
    fs.docs = [orphan('PLG-1')];
    const out = await reconcilePledges();
    expect(fs.docs[0]!['status']).toBe('started');
    expect(out.activated).toBe(0);
    expect(mockEmail).not.toHaveBeenCalled();
    // It did look, and said so - that is what distinguishes "still waiting" from
    // "the cron never ran".
    expect(fs.updates.some((u) => u.data['lastCheckedAt'] instanceof Date)).toBe(true);
  });

  it('marks a mandate the provider rejected as failed, and sends nothing', async () => {
    mockStep3.mockResolvedValue('failed');
    fs.docs = [orphan('PLG-1')];
    const out = await reconcilePledges();
    expect(fs.docs[0]!['status']).toBe('failed');
    expect(out.failed).toBe(1);
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('never re-announces a pledge that is already active', async () => {
    // Defence in depth: the query filters to `started`, but if an active row
    // ever reached this loop, a second "your monthly gift is set up" email about
    // someone's money is a support call, not a cosmetic bug.
    fs.docs = [orphan('PLG-1', { status: 'active' })];
    await reconcilePledges();
    expect(mockEmail).not.toHaveBeenCalled();
    expect(mockStep3).not.toHaveBeenCalled();
  });

  it.each([['cancelled'], ['failed']] as const)('leaves a %s pledge alone', async (status) => {
    fs.docs = [orphan('PLG-1', { status })];
    await reconcilePledges();
    expect(fs.docs[0]!['status']).toBe(status);
    expect(mockStep3).not.toHaveBeenCalled();
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('fails a started pledge that never got a setup session, so the family is not locked out', async () => {
    // startPledge blocks a new pledge while one is `started`. Left as-is, this
    // row would block that family forever.
    fs.docs = [orphan('PLG-1', { setupSessionId: null })];
    await reconcilePledges();
    expect(fs.docs[0]!['status']).toBe('failed');
  });
});

describe('reconcilePledges - one family per failure, never the whole run', () => {
  it('records the error on the row, leaves its status alone, and does not throw', async () => {
    mockStep3.mockRejectedValue(new Error('502 Bad Gateway'));
    fs.docs = [orphan('PLG-1')];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await reconcilePledges();
    // Status untouched: a bad afternoon at Stripe must not mark good pledges
    // dead. The next run tries again.
    expect(fs.docs[0]!['status']).toBe('started');
    expect(String(fs.docs[0]!['lastError'])).toMatch(/502/);
    // The WHOLE result, not just `errored`. The buckets must partition the scan:
    // a mutation that also counted this row as `processing` left the counts
    // summing to more than `scanned`, and every assertion on a single field
    // still passed. Whoever reads the cron output would double-count.
    expect(out).toEqual({ scanned: 1, activated: 0, failed: 0, processing: 0, errored: 1, stale: [], unverified: [] });
    spy.mockRestore();
  });

  it('N=2: one family erroring does not cost the other family their pass', async () => {
    // The single-row fixture is the trap here. With one pledge, a `for` loop and
    // a `Promise.all` that rejects look identical.
    fs.docs = [orphan('PLG-BAD'), orphan('PLG-GOOD')];
    mockStep3.mockImplementation(async (sid: string) => {
      if (sid === 'cs_PLG-BAD') throw new Error('502 Bad Gateway');
      return 'success';
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await reconcilePledges();
    expect(out).toEqual({ scanned: 2, activated: 1, failed: 0, processing: 0, errored: 1, stale: [], unverified: [] });
    expect(fs.docs.find((d) => d.id === 'PLG-GOOD')!['status']).toBe('active');
    expect(fs.docs.find((d) => d.id === 'PLG-BAD')!['status']).toBe('started');
    spy.mockRestore();
  });

  it('N=2: an orphan and a still-pending pledge are each resolved on their own terms', async () => {
    fs.docs = [orphan('PLG-ORPHAN'), orphan('PLG-PENDING')];
    mockStep3.mockImplementation(async (sid: string) => (sid === 'cs_PLG-PENDING' ? 'pending' : 'success'));
    const out = await reconcilePledges();
    expect(out).toMatchObject({ scanned: 2, activated: 1, errored: 0 });
    expect(fs.docs.find((d) => d.id === 'PLG-ORPHAN')!['status']).toBe('active');
    expect(fs.docs.find((d) => d.id === 'PLG-PENDING')!['status']).toBe('started');
  });

  it('never writes lastError onto a pledge it did NOT fail on', async () => {
    fs.docs = [orphan('PLG-BAD'), orphan('PLG-GOOD')];
    mockStep3.mockImplementation(async (sid: string) => {
      if (sid === 'cs_PLG-BAD') throw new Error('502');
      return 'success';
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await reconcilePledges();
    expect(fs.docs.find((d) => d.id === 'PLG-GOOD')!['lastError']).toBeUndefined();
    spy.mockRestore();
  });
});

describe('reconcilePledges - the stale report', () => {
  it('uses a 14-day window - pinned as a literal', () => {
    // Every other assertion in this block builds its fixture FROM
    // STALE_AFTER_DAYS, so all of them would pass unchanged if the constant were
    // quietly widened to 90 and the report went silent for three months. A test
    // that derives its expected value from the thing under test cannot catch a
    // change to that thing.
    expect(STALE_AFTER_DAYS).toBe(14);
  });

  it('reports a pledge stuck in started well beyond the window', async () => {
    mockStep3.mockResolvedValue('pending');
    fs.docs = [
      orphan('PLG-OLD', { startedAt: { toDate: () => daysAgo(STALE_AFTER_DAYS + 6) } }),
      orphan('PLG-NEW', { startedAt: { toDate: () => daysAgo(2) } }),
    ];
    const out = await reconcilePledges();
    // Not a data-protection control - nothing sensitive is stored. It is the
    // signal that the hosted flow itself is broken, which no single row reveals.
    expect(out.stale.map((s) => s.pid)).toEqual(['PLG-OLD']);
    expect(out.stale[0]!.daysStarted).toBeGreaterThanOrEqual(STALE_AFTER_DAYS);
  });

  it('reports staleness from the scan it already did, adding no startedAt query', async () => {
    mockStep3.mockResolvedValue('pending');
    fs.docs = [orphan('PLG-OLD', { startedAt: { toDate: () => daysAgo(30) } })];
    await reconcilePledges();
    // The point is specifically that NO query touches `startedAt` - that is what
    // would have demanded a `pledges(status, startedAt)` composite index. The
    // unverified report's own query is a separate single-field equality.
    expect(fs.queries.some((q) => q.includes('startedAt'))).toBe(false);
    expect(fs.queries).toEqual(['status==started', 'needsStripeVerification==true']);
  });

  it('reports a pledge that just crossed the boundary, not one just short of it', async () => {
    // The boundary is the whole assertion. `>` vs `>=` on a 14-day window is a
    // one-day error nobody would notice by eye.
    mockStep3.mockResolvedValue('pending');
    fs.docs = [
      orphan('PLG-OVER', { startedAt: { toDate: () => daysAgo(STALE_AFTER_DAYS + 1) } }),
      orphan('PLG-UNDER', { startedAt: { toDate: () => daysAgo(STALE_AFTER_DAYS - 1) } }),
    ];
    const out = await reconcilePledges();
    expect(out.stale.map((s) => s.pid)).toEqual(['PLG-OVER']);
  });

  it('does not report a pledge this run just resolved', async () => {
    // It was old, but it is settled now. Reporting it would send a human chasing
    // something the run had already fixed.
    fs.docs = [orphan('PLG-OLD', { startedAt: { toDate: () => daysAgo(30) } })];
    const out = await reconcilePledges();
    expect(out.activated).toBe(1);
    expect(out.stale).toEqual([]);
  });

  it('does not choke on a row with no startedAt', async () => {
    mockStep3.mockResolvedValue('pending');
    fs.docs = [orphan('PLG-1', { startedAt: undefined })];
    const out = await reconcilePledges();
    // Unknown age is not evidence of staleness, and must not crash the run.
    expect(out.stale).toEqual([]);
    expect(out.scanned).toBe(1);
  });
});

describe('reconcilePledges - the unverified-subscription report', () => {
  it('reports a pledge whose subscription was created after it left started', async () => {
    // The residual window advancePledge's pre-step-4 read cannot close: a real
    // recurring debit exists at Stripe against a pledge nobody expected to be
    // debited. advancePledge flags it; this is what makes the flag visible to
    // a human instead of merely present in Firestore.
    fs.docs = [
      orphan('PLG-ORPHAN', { status: 'cancelled', needsStripeVerification: true, subscriptionId: 'sub_live' }),
      orphan('PLG-NORMAL', { status: 'cancelled', subscriptionId: 'sub_ok' }),
    ];
    const out = await reconcilePledges();
    // NOT keyed on `cancelled/failed AND subscriptionId != null`: that is the
    // NORMAL steady state (cancel-pledge does not clear the handle, and a step-5
    // failure keeps it), so it would report PLG-NORMAL too and the signal would
    // drown. Only the flag means "we created a debit nobody expected".
    expect(out.unverified).toEqual(['PLG-ORPHAN']);
  });

  it('reports nothing when no pledge is flagged', async () => {
    fs.docs = [orphan('PLG-1', { status: 'cancelled', subscriptionId: 'sub_ok' })];
    expect((await reconcilePledges()).unverified).toEqual([]);
  });

  it('a failure of the secondary query never costs the reconciliation', async () => {
    // The whole point of the run is repairing orphan mandates. A monitoring
    // query must not be able to take that down.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.throwOnField = 'needsStripeVerification';
    fs.docs = [orphan('PLG-1')];
    const out = await reconcilePledges();
    expect(out.activated).toBe(1);
    expect(out.unverified).toEqual([]);
    spy.mockRestore();
  });
});
