import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getEnrollments, sumCompletedDonations } = vi.hoisted(() => ({
  getEnrollments: vi.fn(),
  sumCompletedDonations: vi.fn(),
}));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({ getEnrollments }));
vi.mock('../donations-sum', () => ({ sumCompletedDonations }));

import { deriveFamilyPayment } from '../payment';

beforeEach(() => { getEnrollments.mockReset(); sumCompletedDonations.mockReset(); });

describe('deriveFamilyPayment', () => {
  it("returns 'unknown' when there are no active enrollments", async () => {
    getEnrollments.mockResolvedValue([{ status: 'cancelled', effectiveSuggestedAmount: 100 }]);
    sumCompletedDonations.mockResolvedValue(0);
    expect(await deriveFamilyPayment('CMT-X')).toBe('unknown');
  });

  it("sums ALL active enrollments (N=2) — outstanding when donations < total expected", async () => {
    getEnrollments.mockResolvedValue([
      { status: 'active', effectiveSuggestedAmount: 100 },
      { status: 'active', effectiveSuggestedAmount: 150 },
    ]);
    sumCompletedDonations.mockResolvedValue(100); // < 250
    expect(await deriveFamilyPayment('CMT-X')).toBe('outstanding');
  });

  it("returns 'paid' when completed donations cover the active total", async () => {
    getEnrollments.mockResolvedValue([
      { status: 'active', effectiveSuggestedAmount: 100 },
      { status: 'active', effectiveSuggestedAmount: 150 },
    ]);
    sumCompletedDonations.mockResolvedValue(250);
    expect(await deriveFamilyPayment('CMT-X')).toBe('paid');
  });

  it("returns 'unknown' (never throws) when a dependency rejects", async () => {
    getEnrollments.mockRejectedValue(new Error('firestore down'));
    expect(await deriveFamilyPayment('CMT-X')).toBe('unknown');
  });
});
