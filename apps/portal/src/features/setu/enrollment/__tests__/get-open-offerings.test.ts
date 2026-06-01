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

import { getOpenOfferings, getOpenOfferingsForFamily } from '../get-open-offerings';

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
