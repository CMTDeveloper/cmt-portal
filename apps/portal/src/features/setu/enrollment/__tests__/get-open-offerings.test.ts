import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore mock ─────────────────────────────────────────────────────────────
const mockWhere = vi.hoisted(() => vi.fn());
const mockOrderBy = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  // Build a fluent chain: collection().where().where().orderBy().get()
  const chain = {
    where: mockWhere,
    orderBy: mockOrderBy,
    get: mockGet,
  };
  mockWhere.mockReturnValue(chain);
  mockOrderBy.mockReturnValue(chain);

  return {
    portalFirestore: vi.fn(() => ({
      collection: vi.fn().mockReturnValue(chain),
    })),
  };
});

import {
  getOpenOfferings,
  getOpenOfferingsForFamily,
  resolveCurrentOffering,
  type OpenOffering,
} from '../get-open-offerings';

// ── resolveCurrentOffering - pure, and the tie-break must be DELIBERATE ───────
describe('resolveCurrentOffering', () => {
  const SAME = new Date('2026-09-13T00:00:00Z');

  function o(over: Partial<OpenOffering> & { oid: string }): OpenOffering {
    return {
      programKey: 'adult-study-class',
      location: 'Brampton',
      startDate: SAME,
      endDate: null,
      enabled: true,
      ...over,
    } as unknown as OpenOffering;
  }

  it('returns null when there are no open offerings', () => {
    expect(resolveCurrentOffering([], 'Brampton')).toBeNull();
  });

  // THE ACCIDENT TEST. getOpenOfferingsForFamily merges located + location-less
  // and sorts by startDate; on an exact tie the winner was decided by the dedupe
  // Map's insertion order (located first) - an accident nothing stated. Both
  // input orderings must now resolve to the SAME offering, or reordering two
  // lines in get-open-offerings.ts silently retargets every caller.
  it('prefers the family location over a location-less offering with the SAME startDate', () => {
    const located = o({ oid: 'asc-brampton', location: 'Brampton' });
    const online = o({ oid: 'asc-online', location: null });
    expect(resolveCurrentOffering([located, online], 'Brampton')?.oid).toBe('asc-brampton');
    expect(resolveCurrentOffering([online, located], 'Brampton')?.oid).toBe('asc-brampton');
  });

  // "Earliest" alone is WRONG here: an online class starting a week before the
  // family's own centre's would otherwise capture every located family.
  it('prefers the family location even when a location-less offering starts EARLIER', () => {
    const located = o({ oid: 'asc-brampton', startDate: new Date('2026-09-20T00:00:00Z') });
    const online = o({ oid: 'asc-online', location: null, startDate: new Date('2026-09-06T00:00:00Z') });
    expect(resolveCurrentOffering([online, located], 'Brampton')?.oid).toBe('asc-brampton');
  });

  it('falls back to the earliest location-less offering when the centre runs none', () => {
    const late = o({ oid: 'asc-online-late', location: null, startDate: new Date('2026-10-01T00:00:00Z') });
    const early = o({ oid: 'asc-online-early', location: null, startDate: new Date('2026-09-06T00:00:00Z') });
    expect(resolveCurrentOffering([late, early], 'Brampton')?.oid).toBe('asc-online-early');
  });

  it('picks the earliest when the centre runs two', () => {
    const fall = o({ oid: 'asc-fall', startDate: new Date('2026-09-13T00:00:00Z') });
    const spring = o({ oid: 'asc-spring', startDate: new Date('2027-01-10T00:00:00Z') });
    expect(resolveCurrentOffering([spring, fall], 'Brampton')?.oid).toBe('asc-fall');
  });

  // Two located offerings on the same day would otherwise resolve by Firestore
  // document order, i.e. non-deterministically across environments.
  it('breaks an exact tie between two located offerings deterministically by oid', () => {
    const b = o({ oid: 'asc-b' });
    const a = o({ oid: 'asc-a' });
    expect(resolveCurrentOffering([b, a], 'Brampton')?.oid).toBe('asc-a');
    expect(resolveCurrentOffering([a, b], 'Brampton')?.oid).toBe('asc-a');
  });

  // The fallback branch must be "location-less only", not "everything left".
  // getOpenOfferingsForFamily can only ever hand this function offerings at the
  // family's own location plus location-less ones - but this is exported for
  // reuse, and getOpenOfferings({programKey}) with no location arg returns EVERY
  // centre's. A caller passing that, for a family whose own centre runs nothing,
  // must get null - never another centre's in-person class.
  it('never falls back to ANOTHER centre in-person offering', () => {
    const scarborough = o({ oid: 'asc-scarborough', location: 'Scarborough', startDate: new Date('2026-09-06T00:00:00Z') });
    expect(resolveCurrentOffering([scarborough], 'Brampton')).toBeNull();
  });

  it('falls back past another centre to the location-less offering', () => {
    const scarborough = o({ oid: 'asc-scarborough', location: 'Scarborough', startDate: new Date('2026-09-06T00:00:00Z') });
    const online = o({ oid: 'asc-online', location: null, startDate: new Date('2026-09-20T00:00:00Z') });
    expect(resolveCurrentOffering([scarborough, online], 'Brampton')?.oid).toBe('asc-online');
  });

  it('resolves over the location-less set for a family with no location', () => {
    const online = o({ oid: 'asc-online', location: null, startDate: new Date('2026-09-06T00:00:00Z') });
    expect(resolveCurrentOffering([online], null)?.oid).toBe('asc-online');
  });

  it('does not mutate the caller array', () => {
    const list = [o({ oid: 'z', startDate: new Date('2027-01-01T00:00:00Z') }), o({ oid: 'a' })];
    const before = list.map((x) => x.oid);
    resolveCurrentOffering(list, 'Brampton');
    expect(list.map((x) => x.oid)).toEqual(before);
  });
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date();
const PAST = new Date(NOW.getTime() - 86400_000 * 60);   // 60 days ago
const FUTURE = new Date(NOW.getTime() + 86400_000 * 30); // 30 days from now
const LONG_PAST = new Date(NOW.getTime() - 86400_000 * 90); // 90 days ago

function makeOfferingData(overrides: Record<string, unknown> = {}) {
  return {
    oid: 'bala-vihar-brampton-2025-26',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    location: 'Brampton',
    termLabel: '2025-26',
    termType: 'term',
    startDate: { toDate: () => PAST },
    endDate: { toDate: () => FUTURE },
    pricingTiers: [{ effectiveFrom: '2025-09-01', amountCAD: 500, label: 'Full year' }],
    paymentSource: 'portal',
    enabled: true,
    createdAt: { toDate: () => PAST },
    createdBy: 'admin',
    updatedAt: { toDate: () => PAST },
    updatedBy: 'admin',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-wire the chain after clearAllMocks
  const chain = { where: mockWhere, orderBy: mockOrderBy, get: mockGet };
  mockWhere.mockReturnValue(chain);
  mockOrderBy.mockReturnValue(chain);
});

// ─────────────────────────────────────────────────────────────────────────────
// getOpenOfferings
// ─────────────────────────────────────────────────────────────────────────────

describe('getOpenOfferings', () => {
  it('returns enabled offerings whose endDate is in the future', async () => {
    mockGet.mockResolvedValue({
      docs: [{ data: () => makeOfferingData() }],
    });

    const results = await getOpenOfferings({ programKey: 'bala-vihar' });
    expect(results).toHaveLength(1);
    expect(results[0]!.oid).toBe('bala-vihar-brampton-2025-26');
    expect(results[0]!.termLabel).toBe('2025-26');
    expect(results[0]!.endDate).toBeInstanceOf(Date);
    expect(results[0]!.startDate).toBeInstanceOf(Date);
  });

  it('returns enabled offerings with null endDate (rolling)', async () => {
    mockGet.mockResolvedValue({
      docs: [{ data: () => makeOfferingData({ endDate: null, termType: 'rolling' }) }],
    });

    const results = await getOpenOfferings({ programKey: 'bala-vihar' });
    expect(results).toHaveLength(1);
    expect(results[0]!.endDate).toBeNull();
  });

  it('filters out offerings whose endDate is in the past', async () => {
    // endDate = LONG_PAST (both startDate and endDate are in the past)
    mockGet.mockResolvedValue({
      docs: [
        { data: () => makeOfferingData({ startDate: { toDate: () => LONG_PAST }, endDate: { toDate: () => PAST } }) },
      ],
    });

    const results = await getOpenOfferings({ programKey: 'bala-vihar' });
    expect(results).toHaveLength(0);
  });

  it('returns multiple offerings sorted by startDate', async () => {
    const earlier = new Date(NOW.getTime() - 86400_000 * 50);
    const later = new Date(NOW.getTime() - 86400_000 * 10);

    mockGet.mockResolvedValue({
      docs: [
        { data: () => makeOfferingData({ oid: 'o1', startDate: { toDate: () => earlier } }) },
        { data: () => makeOfferingData({ oid: 'o2', startDate: { toDate: () => later } }) },
      ],
    });

    const results = await getOpenOfferings({ programKey: 'bala-vihar' });
    expect(results).toHaveLength(2);
    // Order is as returned from Firestore (already ordered by startDate asc via query)
    expect(results[0]!.oid).toBe('o1');
    expect(results[1]!.oid).toBe('o2');
  });

  it('returns empty array when no offerings match', async () => {
    mockGet.mockResolvedValue({ docs: [] });

    const results = await getOpenOfferings({ programKey: 'nonexistent' });
    expect(results).toHaveLength(0);
  });

  it('filters by location when provided', async () => {
    // The query filters happen via Firestore (mocked). We verify getOpenOfferings
    // calls where('location', '==', location) by checking mockWhere calls.
    mockGet.mockResolvedValue({
      docs: [{ data: () => makeOfferingData({ location: 'Mississauga' }) }],
    });

    const results = await getOpenOfferings({ programKey: 'bala-vihar', location: 'Mississauga' });
    expect(results).toHaveLength(1);
    expect(results[0]!.location).toBe('Mississauga');

    // Verify that a location filter was applied in the Firestore query
    const locationWhereCall = mockWhere.mock.calls.find(
      (call) => call[0] === 'location' && call[1] === '==' && call[2] === 'Mississauga',
    );
    expect(locationWhereCall).toBeDefined();
  });

  it('does NOT add location filter when location is undefined', async () => {
    mockGet.mockResolvedValue({ docs: [] });

    await getOpenOfferings({ programKey: 'bala-vihar' });

    const locationWhereCall = mockWhere.mock.calls.find((call) => call[0] === 'location');
    expect(locationWhereCall).toBeUndefined();
  });

  it('maps dates correctly (toDate() Timestamps → Date instances)', async () => {
    mockGet.mockResolvedValue({
      docs: [{ data: () => makeOfferingData() }],
    });

    const results = await getOpenOfferings({ programKey: 'bala-vihar' });
    expect(results[0]!.startDate).toBeInstanceOf(Date);
    expect(results[0]!.createdAt).toBeInstanceOf(Date);
    expect(results[0]!.updatedAt).toBeInstanceOf(Date);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getOpenOfferingsForFamily
// ─────────────────────────────────────────────────────────────────────────────

describe('getOpenOfferingsForFamily', () => {
  const earlier = new Date(NOW.getTime() - 86400_000 * 50);
  const later = new Date(NOW.getTime() - 86400_000 * 10);

  it('located family sees its-location offerings UNION location-less offerings', async () => {
    // First getOpenOfferings call = located query (location == 'Brampton')
    // Second getOpenOfferings call = location-less query (location == null)
    mockGet
      .mockResolvedValueOnce({
        docs: [
          { data: () => makeOfferingData({ oid: 'bv-brampton', location: 'Brampton', startDate: { toDate: () => earlier } }) },
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          { data: () => makeOfferingData({ oid: 'tabla-online', programKey: 'tabla', programLabel: 'Tabla', location: null, startDate: { toDate: () => later } }) },
        ],
      });

    const results = await getOpenOfferingsForFamily('bala-vihar', 'Brampton');
    const oids = results.map((o) => o.oid);
    expect(oids).toContain('bv-brampton');
    expect(oids).toContain('tabla-online');
    expect(results).toHaveLength(2);
  });

  it('located family result is sorted by startDate ascending', async () => {
    // Location-less offering starts earlier than the located one.
    mockGet
      .mockResolvedValueOnce({
        docs: [
          { data: () => makeOfferingData({ oid: 'located-late', location: 'Brampton', startDate: { toDate: () => later } }) },
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          { data: () => makeOfferingData({ oid: 'online-early', location: null, startDate: { toDate: () => earlier } }) },
        ],
      });

    const results = await getOpenOfferingsForFamily('bala-vihar', 'Brampton');
    expect(results.map((o) => o.oid)).toEqual(['online-early', 'located-late']);
  });

  it('dedupes by oid when the same offering appears in both queries', async () => {
    // Defensive: if a doc somehow surfaced in both result sets, it must appear once.
    mockGet
      .mockResolvedValueOnce({
        docs: [{ data: () => makeOfferingData({ oid: 'dup-1', location: 'Brampton' }) }],
      })
      .mockResolvedValueOnce({
        docs: [{ data: () => makeOfferingData({ oid: 'dup-1', location: null }) }],
      });

    const results = await getOpenOfferingsForFamily('bala-vihar', 'Brampton');
    expect(results).toHaveLength(1);
    expect(results[0]!.oid).toBe('dup-1');
  });

  it('null-location family sees ONLY location-less offerings (single query)', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [{ data: () => makeOfferingData({ oid: 'online-only', location: null }) }],
    });

    const results = await getOpenOfferingsForFamily('bala-vihar', null);
    expect(results).toHaveLength(1);
    expect(results[0]!.oid).toBe('online-only');

    // Only the location==null query should have run — exactly one location filter
    // (location == null), no located query.
    const locationCalls = mockWhere.mock.calls.filter((call) => call[0] === 'location');
    expect(locationCalls).toHaveLength(1);
    expect(locationCalls[0]![2]).toBeNull();
  });

  it('null-location family returns empty when no location-less offerings exist', async () => {
    mockGet.mockResolvedValueOnce({ docs: [] });

    const results = await getOpenOfferingsForFamily('bala-vihar', null);
    expect(results).toHaveLength(0);
  });
});
