import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real: isEnrollmentConfirmed (the pure rule) + paymentFromAmounts.
// Mocked: the four per-family reads deriveFamilyRosterSignals composes.
const { getEnrollments, getDonations, getFamilyBalaViharAttendance, getLegacyPaymentStatus } =
  vi.hoisted(() => ({
    getEnrollments: vi.fn(),
    getDonations: vi.fn(),
    getFamilyBalaViharAttendance: vi.fn(),
    getLegacyPaymentStatus: vi.fn(),
  }));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({ getEnrollments }));
vi.mock('@/features/setu/donations/get-donations', () => ({ getDonations }));
vi.mock('@/features/setu/attendance/get-family-attendance', () => ({ getFamilyBalaViharAttendance }));
vi.mock('@/features/setu/donations/legacy-payment', () => ({ getLegacyPaymentStatus }));

import { deriveFamilyRosterSignals } from '../family-engagement';

type AnyRec = Record<string, unknown>;

function bvEnrollment(over: AnyRec = {}) {
  return {
    eid: 'CMT-1-e-bv',
    oid: 'off-bv-2025',
    programKey: 'bala-vihar',
    status: 'active',
    enrolledMids: ['CMT-1-m-0'],
    effectiveSuggestedAmount: 100,
    offering: {
      startDate: new Date('2025-09-01T04:00:00.000Z'),
      endDate: new Date('2026-06-30T03:59:59.000Z'),
      // paymentSource omitted ⇒ 'portal' (not legacy)
    },
    ...over,
  };
}

const CTX = { legacyFid: '715', members: [{ mid: 'CMT-1-m-0', legacySid: 's1' }] };

function attendance(present: number, late = 0) {
  return { present, late, absent: 0, total: present + late, attendedPct: 0 };
}

beforeEach(() => {
  getEnrollments.mockReset();
  getDonations.mockReset();
  getFamilyBalaViharAttendance.mockReset();
  getLegacyPaymentStatus.mockReset();
  getFamilyBalaViharAttendance.mockResolvedValue(attendance(0));
  getLegacyPaymentStatus.mockResolvedValue('unknown');
});

describe('deriveFamilyRosterSignals', () => {
  it("null bvEngagement when there is no active BV enrollment (and no attendance read)", async () => {
    getEnrollments.mockResolvedValue([
      { eid: 'e1', oid: 'off-tabla', programKey: 'tabla', status: 'active', enrolledMids: [], effectiveSuggestedAmount: 50, offering: null },
    ]);
    getDonations.mockResolvedValue([]);

    const res = await deriveFamilyRosterSignals('CMT-1', CTX);
    expect(res.bvEngagement).toBeNull();
    expect(getFamilyBalaViharAttendance).not.toHaveBeenCalled();
    expect(getLegacyPaymentStatus).not.toHaveBeenCalled();
  });

  it("'confirmed' from a completed donation for the BV eid — WITHOUT an attendance read (short-circuit)", async () => {
    getEnrollments.mockResolvedValue([bvEnrollment()]);
    getDonations.mockResolvedValue([
      { status: 'completed', eid: 'CMT-1-e-bv', amountCAD: 100 },
    ]);

    const res = await deriveFamilyRosterSignals('CMT-1', CTX);
    expect(res.bvEngagement).toBe('confirmed');
    expect(res.payment).toBe('paid'); // 100 >= expected 100
    expect(getFamilyBalaViharAttendance).not.toHaveBeenCalled();
  });

  it("'registered' when active BV but no donation, no legacy, and zero attendance", async () => {
    getEnrollments.mockResolvedValue([bvEnrollment()]);
    getDonations.mockResolvedValue([]);
    getFamilyBalaViharAttendance.mockResolvedValue(attendance(0));

    const res = await deriveFamilyRosterSignals('CMT-1', CTX);
    expect(res.bvEngagement).toBe('registered');
    expect(res.payment).toBe('outstanding'); // 0 < 100
    expect(getFamilyBalaViharAttendance).toHaveBeenCalledTimes(1);
  });

  it("'confirmed' from attendance when the donation side is inconclusive", async () => {
    getEnrollments.mockResolvedValue([bvEnrollment()]);
    getDonations.mockResolvedValue([]);
    getFamilyBalaViharAttendance.mockResolvedValue(attendance(2, 1));

    const res = await deriveFamilyRosterSignals('CMT-1', CTX);
    expect(res.bvEngagement).toBe('confirmed');
    expect(getFamilyBalaViharAttendance).toHaveBeenCalledTimes(1);
  });

  it("'confirmed' from legacy-paid on a legacy-sourced offering — WITHOUT an attendance read", async () => {
    getEnrollments.mockResolvedValue([
      bvEnrollment({ offering: { startDate: new Date('2025-09-01'), endDate: null, paymentSource: 'legacy' } }),
    ]);
    getDonations.mockResolvedValue([]);
    getLegacyPaymentStatus.mockResolvedValue('paid');

    const res = await deriveFamilyRosterSignals('CMT-1', CTX);
    expect(res.bvEngagement).toBe('confirmed');
    expect(getLegacyPaymentStatus).toHaveBeenCalledWith('715');
    expect(getFamilyBalaViharAttendance).not.toHaveBeenCalled();
  });

  it('never throws — a read failure yields unknown/null', async () => {
    getEnrollments.mockRejectedValue(new Error('boom'));
    const res = await deriveFamilyRosterSignals('CMT-1', CTX);
    expect(res).toEqual({ payment: 'unknown', bvEngagement: null });
  });
});
