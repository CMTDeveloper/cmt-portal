import { describe, it, expect, vi } from 'vitest';

// ── Firestore mock ──────────────────────────────────────────────────────────
// getEnrollments touches two paths:
//   families/{fid}/enrollments.orderBy('enrolledAt','desc').get()
//   offerings/{oid}.get()
const enrollmentsGet = vi.hoisted(() => vi.fn());
const offeringGet = vi.hoisted(() => vi.fn());

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const orderBy = vi.fn();
  const enrollmentsChain = { orderBy, get: enrollmentsGet };
  orderBy.mockReturnValue(enrollmentsChain);
  const familyDoc = { collection: vi.fn(() => enrollmentsChain) };
  const familiesCollection = { doc: vi.fn(() => familyDoc) };
  const offeringsCollection = { doc: vi.fn(() => ({ get: offeringGet })) };
  return {
    portalFirestore: vi.fn(() => ({
      collection: vi.fn((name: string) => (name === 'offerings' ? offeringsCollection : familiesCollection)),
    })),
  };
});

import { getEnrollments } from '../get-enrollments';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ENROLL_DATE = new Date('2025-10-01T12:00:00Z');

function enrollmentData(overrides: Record<string, unknown> = {}) {
  return {
    eid: 'CMT-MATTA-tabla-2026',
    oid: 'tabla-2026',
    fid: 'CMT-MATTA',
    programKey: 'tabla',
    programLabel: 'Tabla classes',
    termLabel: '2026',
    status: 'active',
    enrolledMids: ['CMT-MATTA-01'],
    location: 'Brampton',
    suggestedAmountSnapshot: 500, // the OLD rate, captured at enroll time
    enrolledAt: { toDate: () => ENROLL_DATE },
    cancelledAt: null,
    ...overrides,
  };
}

function offeringData(overrides: Record<string, unknown> = {}) {
  return {
    oid: 'tabla-2026',
    programKey: 'tabla',
    programLabel: 'Tabla classes',
    location: 'Brampton',
    termLabel: '2026',
    termType: 'term',
    startDate: { toDate: () => new Date('2025-09-01') },
    endDate: { toDate: () => new Date('2027-06-30') },
    // Admin LOWERED the rate 500 → 300 after the family enrolled.
    pricingTiers: [{ effectiveFrom: '2025-09-01', amountCAD: 300, label: 'Year' }],
    paymentSource: 'portal',
    enabled: true,
    createdAt: { toDate: () => new Date('2025-08-01') },
    createdBy: 'admin',
    updatedAt: { toDate: () => new Date('2026-06-01') },
    updatedBy: 'admin',
    ...overrides,
  };
}

describe('getEnrollments — effectiveSuggestedAmount', () => {
  it('uses the current offering rate (resolved at enroll date), not the enroll-time snapshot', async () => {
    enrollmentsGet.mockResolvedValue({ empty: false, docs: [{ data: () => enrollmentData() }] });
    offeringGet.mockResolvedValue({ exists: true, id: 'tabla-2026', data: () => offeringData() });

    const result = await getEnrollments('CMT-MATTA');

    expect(result).toHaveLength(1);
    // Admin lowered 500 → 300; the live offering rate wins over the 500 snapshot.
    expect(result[0]!.effectiveSuggestedAmount).toBe(300);
    expect(result[0]!.offering?.oid).toBe('tabla-2026');
  });

  it('a per-family override always wins over the live offering rate', async () => {
    enrollmentsGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => enrollmentData({ suggestedAmountOverride: 250 }) }],
    });
    offeringGet.mockResolvedValue({ exists: true, id: 'tabla-2026', data: () => offeringData() });

    const result = await getEnrollments('CMT-MATTA');

    expect(result[0]!.effectiveSuggestedAmount).toBe(250);
  });

  it('falls back to the enroll-time snapshot when the offering doc is gone', async () => {
    enrollmentsGet.mockResolvedValue({ empty: false, docs: [{ data: () => enrollmentData() }] });
    offeringGet.mockResolvedValue({ exists: false });

    const result = await getEnrollments('CMT-MATTA');

    expect(result[0]!.offering).toBeNull();
    expect(result[0]!.effectiveSuggestedAmount).toBe(500);
  });

  it('returns [] for a family with no enrollments', async () => {
    enrollmentsGet.mockResolvedValue({ empty: true, docs: [] });

    const result = await getEnrollments('CMT-NOBODY');

    expect(result).toEqual([]);
  });
});
