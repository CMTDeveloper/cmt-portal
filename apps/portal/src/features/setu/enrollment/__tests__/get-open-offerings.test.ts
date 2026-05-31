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

import { getOpenOfferings } from '../get-open-offerings';

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
