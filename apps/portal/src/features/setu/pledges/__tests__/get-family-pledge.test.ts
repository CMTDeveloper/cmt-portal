import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The read behind the family card. Two things matter here and nothing else does:
 * the query shape (which decides whether this needs a composite index nobody
 * deployed), and what the returned object is allowed to contain.
 */

type Doc = Record<string, unknown> & { id: string };
const { fs } = vi.hoisted(() => ({
  fs: { docs: [] as Doc[], calls: [] as string[] },
}));

/** A Firestore Timestamp is NOT a Date - it only has .toDate(). */
function ts(iso: string) {
  return { toDate: () => new Date(iso) };
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: (name: string) => {
      fs.calls.push(`collection:${name}`);
      const q = {
        where: (field: string, op: string, value: unknown) => {
          fs.calls.push(`where:${field}${op}${String(value)}`);
          return {
            ...q,
            get: async () => ({
              docs: fs.docs
                .filter((d) => d[field] === value)
                .map((d) => ({ id: d.id, data: () => d })),
            }),
          };
        },
        orderBy: (field: string) => {
          fs.calls.push(`orderBy:${field}`);
          return q;
        },
      };
      return q;
    },
  }),
}));

import { getFamilyPledge } from '../get-family-pledge';

beforeEach(() => {
  fs.docs = [];
  fs.calls = [];
});

describe('getFamilyPledge', () => {
  it('returns null for a family that has never started one', async () => {
    expect(await getFamilyPledge('CMT-A')).toBeNull();
  });

  it('queries by fid ALONE, with no orderBy - so it needs no composite index', async () => {
    // Firestore auto-indexes a single-field equality. Adding an orderBy here
    // would silently require a `pledges(fid, startedAt)` composite index that
    // firestore.indexes.json does not declare, and the failure would only show
    // up against real Firestore - never in this suite, which is index-blind.
    await getFamilyPledge('CMT-A');
    expect(fs.calls).toEqual(['collection:pledges', 'where:fid==CMT-A']);
  });

  it('converts Firestore Timestamps to real Dates', async () => {
    fs.docs = [
      {
        id: 'PLG-1', fid: 'CMT-A', status: 'active', monthlyAmountCAD: 51,
        startedAt: ts('2026-02-01T00:00:00Z'), activatedAt: ts('2026-02-03T00:00:00Z'),
      },
    ];
    const got = await getFamilyPledge('CMT-A');
    // A raw Timestamp reaching the card would blow up on .getTime(); asserting
    // the instance is the point, the value is the corroboration.
    expect(got?.startedAt).toBeInstanceOf(Date);
    expect(got?.activatedAt).toBeInstanceOf(Date);
    expect(got?.activatedAt?.toISOString()).toBe('2026-02-03T00:00:00.000Z');
  });

  it('keeps activatedAt null rather than inventing an epoch date', async () => {
    fs.docs = [
      { id: 'PLG-1', fid: 'CMT-A', status: 'started', monthlyAmountCAD: 51, startedAt: ts('2026-02-01T00:00:00Z'), activatedAt: null },
    ];
    // `new Date(null)` is 1970-01-01, not an error - so a careless conversion
    // would have the card announce a family has been giving since 1970.
    expect((await getFamilyPledge('CMT-A'))?.activatedAt).toBeNull();
  });

  it('never returns the Stripe handles', async () => {
    fs.docs = [
      {
        id: 'PLG-1', fid: 'CMT-A', status: 'active', monthlyAmountCAD: 51,
        startedAt: ts('2026-02-01T00:00:00Z'), activatedAt: ts('2026-02-03T00:00:00Z'),
        setupSessionId: 'cs_test_LEAK', subscriptionId: 'sub_LEAK', customerId: 'cus_LEAK',
        lastError: 'card_declined at 4242',
      },
    ];
    const got = await getFamilyPledge('CMT-A');
    // This object is serialized into the page the family receives. A spread of
    // the raw doc would ship provider handles and a raw provider error string
    // into the HTML - which is exactly why the mapping names its fields.
    expect(JSON.stringify(got)).not.toMatch(/LEAK|card_declined/);
    expect(Object.keys(got ?? {}).sort()).toEqual(
      ['activatedAt', 'monthlyAmountCAD', 'pid', 'startedAt', 'status'].sort(),
    );
  });

  it('applies the ranking, not raw document order (N=2)', async () => {
    fs.docs = [
      { id: 'PLG-NEW-FAIL', fid: 'CMT-A', status: 'failed', monthlyAmountCAD: 51, startedAt: ts('2026-06-01T00:00:00Z'), activatedAt: null },
      { id: 'PLG-LIVE', fid: 'CMT-A', status: 'active', monthlyAmountCAD: 51, startedAt: ts('2026-01-01T00:00:00Z'), activatedAt: ts('2026-01-02T00:00:00Z') },
    ];
    expect((await getFamilyPledge('CMT-A'))?.pid).toBe('PLG-LIVE');
  });

  it('ignores another family\'s pledges', async () => {
    fs.docs = [
      { id: 'PLG-OTHER', fid: 'CMT-B', status: 'active', monthlyAmountCAD: 51, startedAt: ts('2026-01-01T00:00:00Z'), activatedAt: ts('2026-01-02T00:00:00Z') },
    ];
    expect(await getFamilyPledge('CMT-A')).toBeNull();
  });

  it('takes pid from the document id, not a pid field that could disagree', async () => {
    fs.docs = [
      { id: 'PLG-REAL', fid: 'CMT-A', pid: 'PLG-STALE', status: 'started', monthlyAmountCAD: 51, startedAt: ts('2026-01-01T00:00:00Z'), activatedAt: null },
    ];
    expect((await getFamilyPledge('CMT-A'))?.pid).toBe('PLG-REAL');
  });

  it('falls back to the configured amount when a legacy doc has none', async () => {
    fs.docs = [
      { id: 'PLG-1', fid: 'CMT-A', status: 'active', monthlyAmountCAD: undefined, startedAt: ts('2026-01-01T00:00:00Z'), activatedAt: ts('2026-01-02T00:00:00Z') },
    ];
    // Never NaN or undefined on screen: "You're giving $NaN monthly" is worse
    // than a slightly wrong number, and the default IS the only amount we ship.
    expect((await getFamilyPledge('CMT-A'))?.monthlyAmountCAD).toBe(51);
  });
});
