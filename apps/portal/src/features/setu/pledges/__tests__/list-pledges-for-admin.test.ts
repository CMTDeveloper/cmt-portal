import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The projection behind `/admin/pledges`.
 *
 * It had no tests, and a mutation run found why that mattered: the write side
 * flags an anomalous subscription and the screen renders the flag, but nothing
 * checked that the projection in between actually reads it off the document.
 * Hardcoding the field to `false` passed the entire suite - both ends of a
 * three-link chain were tested and the middle was not.
 */

type Doc = Record<string, unknown> & { id: string };
const { fs } = vi.hoisted(() => ({
  fs: { docs: [] as Doc[], families: {} as Record<string, unknown>, calls: [] as string[] },
}));

function ts(iso: string) {
  return { toDate: () => new Date(iso) };
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const db = {
    collection: (name: string) => {
      const q = {
        doc: (id: string) => ({ __col: name, id }),
        orderBy: (field: string, dir: string) => {
          fs.calls.push(`orderBy:${field}:${dir}`);
          return q;
        },
        limit: (n: number) => {
          fs.calls.push(`limit:${n}`);
          return q;
        },
        where: (f: string) => {
          fs.calls.push(`where:${f}`);
          return q;
        },
        get: async () => ({ docs: fs.docs.map((d) => ({ id: d.id, data: () => d })) }),
      };
      return q;
    },
    getAll: async (...refs: Array<{ id: string }>) => {
      fs.calls.push(`getAll:${refs.length}`);
      return refs.map((r) => ({ id: r.id, data: () => fs.families[r.id] }));
    },
  };
  return { portalFirestore: () => db };
});

import { listPledgesForAdmin } from '../list-pledges-for-admin';

function pledge(over: Partial<Doc> & { id: string }): Doc {
  return {
    fid: 'CMT-A', status: 'active', monthlyAmountCAD: 51,
    startedAt: ts('2026-02-01T00:00:00Z'), activatedAt: ts('2026-02-03T00:00:00Z'), cancelledAt: null,
    ...over,
  } as Doc;
}

beforeEach(() => {
  fs.docs = [];
  fs.families = { 'CMT-A': { name: 'Rao' } };
  fs.calls = [];
});

describe('listPledgesForAdmin', () => {
  it('reads the verification flag off the document', async () => {
    fs.docs = [pledge({ id: 'PLG-1', status: 'cancelled', needsStripeVerification: true })];
    // The middle link of the chain: Firestore flags it, this projects it, the
    // screen renders it. A hardcoded `false` here breaks the whole point while
    // leaving both ends green.
    expect((await listPledgesForAdmin())[0]!.needsStripeVerification).toBe(true);
  });

  it('does not invent the flag when the field is absent', async () => {
    fs.docs = [pledge({ id: 'PLG-1' })];
    expect((await listPledgesForAdmin())[0]!.needsStripeVerification).toBe(false);
  });

  it('treats a non-boolean value as not flagged', async () => {
    // Strict `=== true`, so a stray string cannot light a warning chip.
    fs.docs = [pledge({ id: 'PLG-1', needsStripeVerification: 'yes' })];
    expect((await listPledgesForAdmin())[0]!.needsStripeVerification).toBe(false);
  });

  it('NEVER projects the provider handles', async () => {
    fs.docs = [pledge({
      id: 'PLG-1',
      setupSessionId: 'cs_LEAK', subscriptionId: 'sub_LEAK', customerId: 'cus_LEAK',
      lastError: 'raw provider text',
    })];
    // This object is serialized into the admin page's HTML. The module's comment
    // has always claimed the handles are not projected; this is what makes the
    // claim true rather than aspirational.
    const rows = await listPledgesForAdmin();
    expect(JSON.stringify(rows)).not.toMatch(/LEAK|raw provider text/);
  });

  it('orders newest-first and caps the page, with NO where clause', async () => {
    fs.docs = [pledge({ id: 'PLG-1' })];
    await listPledgesForAdmin();
    // A single-field orderBy with no filter is auto-indexed in both directions.
    // Adding a `where` here would cross into composite-index territory that
    // firestore.indexes.json does not declare, and this suite is index-blind.
    expect(fs.calls).toContain('orderBy:startedAt:desc');
    expect(fs.calls.some((c) => c.startsWith('where:'))).toBe(false);
    expect(fs.calls.some((c) => c.startsWith('limit:'))).toBe(true);
  });

  it('joins family names in ONE bulk read, never a per-row get (N=2)', async () => {
    fs.families = { 'CMT-A': { name: 'Rao' }, 'CMT-B': { name: 'Iyer' } };
    fs.docs = [pledge({ id: 'PLG-1', fid: 'CMT-A' }), pledge({ id: 'PLG-2', fid: 'CMT-B' })];
    const rows = await listPledgesForAdmin();
    expect(rows.map((r) => r.familyName)).toEqual(['Rao', 'Iyer']);
    // The repo's standing rule after a per-family fan-out timed out at ~45s
    // across 769 families.
    expect(fs.calls.filter((c) => c.startsWith('getAll:'))).toEqual(['getAll:2']);
  });

  it('deduplicates fids so two pledges from one family are read once', async () => {
    fs.docs = [pledge({ id: 'PLG-1' }), pledge({ id: 'PLG-2', status: 'cancelled' })];
    await listPledgesForAdmin();
    expect(fs.calls.filter((c) => c.startsWith('getAll:'))).toEqual(['getAll:1']);
  });

  it('falls back to null when a family name cannot be joined', async () => {
    fs.families = {};
    fs.docs = [pledge({ id: 'PLG-1' })];
    expect((await listPledgesForAdmin())[0]!.familyName).toBeNull();
  });

  it('marks only started and active rows cancellable', async () => {
    fs.docs = [
      pledge({ id: 'A', status: 'started' }), pledge({ id: 'B', status: 'active' }),
      pledge({ id: 'C', status: 'failed' }), pledge({ id: 'D', status: 'cancelled' }),
    ];
    expect((await listPledgesForAdmin()).map((r) => r.cancellable)).toEqual([true, true, false, false]);
  });

  it('converts Timestamps to Dates and keeps a missing one null', async () => {
    fs.docs = [pledge({ id: 'PLG-1', activatedAt: null })];
    const row = (await listPledgesForAdmin())[0]!;
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.activatedAt).toBeNull();
  });

  it('does no family read at all when there are no pledges', async () => {
    expect(await listPledgesForAdmin()).toEqual([]);
    expect(fs.calls.some((c) => c.startsWith('getAll:'))).toBe(false);
  });
});
