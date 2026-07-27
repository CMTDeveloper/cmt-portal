import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getEnrollments, sumCompletedDonations } = vi.hoisted(() => ({
  getEnrollments: vi.fn(),
  sumCompletedDonations: vi.fn(),
}));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({ getEnrollments }));
vi.mock('../donations-sum', () => ({ sumCompletedDonations }));

import { deriveFamilyPayment } from '../payment';

const ENROLLED = new Date('2026-09-15T12:00:00Z');

/**
 * A realistic joined enrollment. The fixtures here previously set only
 * `effectiveSuggestedAmount`, which no longer feeds the verdict — the classifier
 * reads the raw pieces so it can tell "this is free" apart from "we never found
 * a price", and a fixture missing them looks exactly like the latter.
 */
function enrollment(over: {
  status?: string;
  amountCAD?: number | null;
  override?: number | null;
  snapshot?: number;
  paymentSource?: string;
  offeringMissing?: boolean;
} = {}) {
  const amountCAD = over.amountCAD === undefined ? 100 : over.amountCAD;
  return {
    status: over.status ?? 'active',
    suggestedAmountOverride: over.override ?? null,
    suggestedAmountSnapshot: over.snapshot ?? 0,
    enrolledAt: ENROLLED,
    offering: over.offeringMissing
      ? null
      : {
          pricingTiers: amountCAD === null ? [] : [{ effectiveFrom: '2026-09-01', amountCAD, label: 'Full year' }],
          ...(over.paymentSource ? { paymentSource: over.paymentSource } : {}),
        },
  };
}

beforeEach(() => { getEnrollments.mockReset(); sumCompletedDonations.mockReset(); });

describe('deriveFamilyPayment', () => {
  it("returns 'unknown' when there are no active enrollments", async () => {
    getEnrollments.mockResolvedValue([enrollment({ status: 'cancelled' })]);
    sumCompletedDonations.mockResolvedValue(0);
    expect(await deriveFamilyPayment('CMT-X')).toBe('unknown');
  });

  it("sums ALL active enrollments (N=2) — outstanding when donations < total expected", async () => {
    getEnrollments.mockResolvedValue([enrollment(), enrollment({ amountCAD: 150 })]);
    sumCompletedDonations.mockResolvedValue(100); // < 250
    expect(await deriveFamilyPayment('CMT-X')).toBe('outstanding');
  });

  it("returns 'paid' when completed donations cover the active total", async () => {
    getEnrollments.mockResolvedValue([enrollment(), enrollment({ amountCAD: 150 })]);
    sumCompletedDonations.mockResolvedValue(250);
    expect(await deriveFamilyPayment('CMT-X')).toBe('paid');
  });

  it("returns 'not-applicable' when every active enrollment is free or waived", async () => {
    getEnrollments.mockResolvedValue([enrollment({ amountCAD: null }), enrollment({ override: 0 })]);
    sumCompletedDonations.mockResolvedValue(0);
    expect(await deriveFamilyPayment('CMT-X')).toBe('not-applicable');
  });

  // The whole reason the raw pieces are threaded through: a deleted offering doc
  // with a snapshot of 0 must not be reported as owing nothing.
  it("returns 'unknown' when an enrollment cannot be priced at all", async () => {
    getEnrollments.mockResolvedValue([enrollment({ offeringMissing: true, snapshot: 0 })]);
    sumCompletedDonations.mockResolvedValue(0);
    expect(await deriveFamilyPayment('CMT-X')).toBe('unknown');
  });

  it("returns 'unknown' (never throws) when a dependency rejects", async () => {
    getEnrollments.mockRejectedValue(new Error('firestore down'));
    expect(await deriveFamilyPayment('CMT-X')).toBe('unknown');
  });
});
