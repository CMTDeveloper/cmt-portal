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

  // The single line the entire Adult Study Class fee rule rests on. The exemption
  // for a Bala-Vihar-paid family is stored as an override of 0, so if this read
  // were ever "simplified" from `??` to `||`, the 0 would fall through to the
  // live offering rate and the family would be billed the full amount - a
  // silently wrong number on a screen that asks for money.
  it('honours an override of ZERO — it must not fall through to the offering rate', async () => {
    enrollmentsGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => enrollmentData({ suggestedAmountOverride: 0 }) }],
    });
    offeringGet.mockResolvedValue({ exists: true, id: 'tabla-2026', data: () => offeringData() });

    const result = await getEnrollments('CMT-MATTA');

    expect(result[0]!.effectiveSuggestedAmount).toBe(0);
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

// ── Every Date field must survive the Firestore→object conversion ────────────
//
// 🔴 `settledAt` was added to EnrollmentDocSchema on 2026-08-06 and NOT added to
// `rawToEnrollment`, which converts `enrolledAt` and `cancelledAt` by hand and
// spreads everything else through raw. A Firestore `Timestamp` is not a `Date`
// and has no `toLocaleDateString`, so `/welcome/family/[fid]` would have thrown
// server-side - for EVERY staff role, since the settlement line renders for all
// of them - the first time anyone marked a family settled off-portal.
//
// The `as Omit<EnrollmentDoc, ...>` cast is what hid it: it asserts the raw
// object already matches the type for every field not named, which is a lie for
// exactly the field someone forgot. The compiler cannot help here, so this test
// is the guard.
describe('rawToEnrollment converts EVERY timestamp, not just the two it started with', () => {
  const SETTLED = new Date('2026-08-03T15:00:00Z');

  it('turns a Firestore Timestamp settledAt into a real Date', async () => {
    enrollmentsGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          data: () =>
            enrollmentData({
              settledOffPortal: true,
              // Exactly what the Admin SDK hands back: an object with toDate(),
              // NOT a Date. `FieldValue.serverTimestamp()` writes one of these.
              settledAt: { toDate: () => SETTLED },
              settledBy: 'treasurer@chinmayatoronto.org',
              settledNote: 'cheque',
            }),
        },
      ],
    });
    offeringGet.mockResolvedValue({ exists: false });

    const rows = await getEnrollments('CMT-MATTA');

    expect(rows[0]?.settledAt).toBeInstanceOf(Date);
    expect(rows[0]?.settledAt?.getTime()).toBe(SETTLED.getTime());
    // The thing that actually crashed: any screen formatting the value.
    expect(() => rows[0]!.settledAt!.toLocaleDateString('en-CA')).not.toThrow();
  });

  it('leaves settledAt null on an enrollment that was never settled', async () => {
    // Every enrollment written before 2026-08-06 lacks the field entirely, so
    // absent must read as null rather than becoming `new Date(undefined)`.
    enrollmentsGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => enrollmentData() }],
    });
    offeringGet.mockResolvedValue({ exists: false });

    const rows = await getEnrollments('CMT-MATTA');

    expect(rows[0]?.settledAt).toBeNull();
  });
});
