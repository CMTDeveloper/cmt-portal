import { describe, it, expect } from 'vitest';
import {
  buildFamilyDashboardModel,
  isLegacyBvPeriod,
  type DashboardModelInput,
} from '../_helpers/dashboard-model';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import type { ResolvedSummary } from '@/features/setu/attendance/resolve-attendance';
import type { DonationDoc, ProgramDoc, OfferingDoc } from '@cmt/shared-domain';

// ─── Fixtures ───────────────────────────────────────────────────────────────
// Mirrors the real UAT scenario that produced the bug: a family enrolled in both
// Bala Vihar 2025-26 and (more recently) Tabla 2026-27, with check-ins that fall
// inside the BV window but NOT the Tabla window.

const BV_OFFERING: OfferingDoc = {
  oid: 'bv-brampton-2025-26',
  programKey: 'bala-vihar',
  programLabel: 'Bala Vihar',
  location: 'Brampton',
  termLabel: '2025-26',
  termType: 'term',
  startDate: new Date('2025-09-07'),
  endDate: new Date('2026-06-15'),
  pricingTiers: [],
  enabled: true,
  createdAt: new Date('2025-01-01'),
  createdBy: 'admin',
  updatedAt: new Date('2025-01-01'),
  updatedBy: 'admin',
};

const TABLA_OFFERING: OfferingDoc = {
  oid: 'tabla-brampton-2026-27',
  programKey: 'tabla',
  programLabel: 'Tabla classes',
  location: 'Brampton',
  termLabel: '2026-27',
  termType: 'rolling',
  startDate: new Date('2026-09-15'),
  endDate: new Date('2027-06-15'),
  pricingTiers: [],
  enabled: true,
  createdAt: new Date('2026-01-01'),
  createdBy: 'admin',
  updatedAt: new Date('2026-01-01'),
  updatedBy: 'admin',
};

function makeEnrollment(overrides: Partial<EnrollmentWithOffering> = {}): EnrollmentWithOffering {
  return {
    eid: 'CMT-AAAA-bv-brampton-2025-26',
    fid: 'CMT-AAAA',
    oid: 'bv-brampton-2025-26',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    termLabel: '2025-26',
    location: 'Brampton',
    enrolledAt: new Date('2025-09-01'),
    enrolledVia: 'family-initiated',
    enrolledByMid: 'CMT-AAAA-01',
    enrolledMids: ['CMT-AAAA-03'],
    suggestedAmountSnapshot: 200,
    suggestedAmountOverride: null,
    status: 'active',
    cancelledAt: null,
    cancelledReason: null,
    effectiveSuggestedAmount: 200,
    offering: BV_OFFERING,
    ...overrides,
  };
}

const BV_ENROLLMENT = makeEnrollment();
const TABLA_ENROLLMENT = makeEnrollment({
  eid: 'CMT-AAAA-tabla-brampton-2026-27',
  oid: 'tabla-brampton-2026-27',
  programKey: 'tabla',
  programLabel: 'Tabla classes',
  termLabel: '2026-27',
  enrolledAt: new Date('2026-05-30'), // newer → sorts first in getEnrollments (DESC)
  enrolledMids: ['CMT-AAAA-01', 'CMT-AAAA-02', 'CMT-AAAA-03'],
  suggestedAmountSnapshot: 300,
  effectiveSuggestedAmount: 300,
  offering: TABLA_OFFERING,
});

function bvProgram(overrides: Partial<ProgramDoc> = {}): ProgramDoc {
  return {
    programKey: 'bala-vihar',
    label: 'Bala Vihar',
    shortDescription: 'Sunday school',
    status: 'active',
    locations: ['Brampton'],
    termType: 'term',
    eligibility: { memberType: 'child' },
    capabilities: { usesOfferings: true, usesDonation: true, usesLevels: true, usesCalendar: true, attendanceMode: 'check-in' },
    displayOrder: 0,
    createdAt: new Date('2025-01-01'),
    createdBy: 'admin',
    updatedAt: new Date('2025-01-01'),
    updatedBy: 'admin',
    ...overrides,
  };
}

function tablaProgram(overrides: Partial<ProgramDoc> = {}): ProgramDoc {
  return {
    programKey: 'tabla',
    label: 'Tabla classes',
    shortDescription: 'Rhythm',
    status: 'active',
    locations: ['Brampton'],
    termType: 'rolling',
    eligibility: { memberType: 'any' },
    capabilities: { usesOfferings: true, usesDonation: false, usesLevels: false, usesCalendar: false, attendanceMode: 'none' },
    displayOrder: 1,
    createdAt: new Date('2026-01-01'),
    createdBy: 'admin',
    updatedAt: new Date('2026-01-01'),
    updatedBy: 'admin',
    ...overrides,
  };
}

const PROGRAMS = new Map<string, ProgramDoc>([
  ['bala-vihar', bvProgram()],
  ['tabla', tablaProgram()],
]);

function resolved(marks: { date: string; status: 'present' | 'late' | 'absent'; source?: 'portal' | 'door' }[]): ResolvedSummary {
  const sorted = [...marks].sort((a, b) => a.date.localeCompare(b.date)).map((m) => ({ ...m, source: m.source ?? 'door' }));
  const present = sorted.filter((m) => m.status === 'present').length;
  const late = sorted.filter((m) => m.status === 'late').length;
  const absent = sorted.filter((m) => m.status === 'absent').length;
  const total = sorted.length;
  return { present, late, absent, total, attendedPct: total ? Math.round(((present + late) / total) * 100) : 0, marks: sorted };
}

// The family-level BV union the page now computes (teacher marks ∪ door check-ins,
// already window-scoped by the reader) — two attended Sundays.
const BV_ATTENDANCE = resolved([{ date: '2025-10-05', status: 'present' }, { date: '2026-01-11', status: 'present' }]);

function makeDonation(overrides: Partial<DonationDoc> = {}): DonationDoc {
  return {
    fid: 'CMT-AAAA',
    type: 'enrollment',
    programKey: 'tabla',
    programLabel: 'Tabla classes',
    pid: null,
    eid: 'CMT-AAAA-tabla-brampton-2026-27',
    label: 'Tabla classes Donation — 2026-27',
    amountCAD: 300,
    status: 'completed',
    createdAt: new Date('2026-05-30'),
    createdBy: 'CMT-AAAA-01',
    updatedAt: new Date('2026-05-30'),
    updatedBy: 'CMT-AAAA-01',
    ...overrides,
  } as DonationDoc;
}

function input(overrides: Partial<DashboardModelInput> = {}): DashboardModelInput {
  return {
    enrollments: [TABLA_ENROLLMENT, BV_ENROLLMENT], // Tabla first (enrolledAt DESC)
    donations: [],
    programsById: PROGRAMS,
    bvAttendance: BV_ATTENDANCE,
    classSundaysHeld: 30,
    legacyPaymentStatus: null,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('buildFamilyDashboardModel — BV section pins to Bala Vihar', () => {
  it('REGRESSION: a newer Tabla enrollment does not hijack the BV term/amount', () => {
    const m = buildFamilyDashboardModel(input());
    expect(m.isEnrolled).toBe(true);
    expect(m.enrollPeriodLabel).toBe('2025-26'); // BV's term, NOT Tabla's 2026-27
    expect(m.suggestedAmount).toBe(200); // BV's amount, NOT Tabla's 300
  });

  it('formats the passed BV attendance union (window-scoping lives in the reader)', () => {
    const m = buildFamilyDashboardModel(input());
    // The page now passes a pre-scoped family-level union; the model just formats
    // it. Two attended Sundays over classSundaysHeld=30.
    expect(m.attendance.hasAttendance).toBe(true);
    expect(m.attendance.summary.attended).toBe(2);
    expect(m.attendance.total).toBe(30); // classSundaysHeld
  });

  it('renders one card per non-BV active enrollment (Tabla), excluding BV', () => {
    const m = buildFamilyDashboardModel(input());
    expect(m.otherProgramCards.map((c) => c.programKey)).toEqual(['tabla']);
  });

  it('kidsEnrolled counts the BV enrolledMids, not all Child members (#4)', () => {
    // BV enrollment has 1 enrolledMid; the Tabla enrollment has 3. The BV card's
    // "Kids enrolled" must reflect BV (1), not the family's child count.
    const m = buildFamilyDashboardModel(input());
    expect(m.kidsEnrolled).toBe(1);
    // Not enrolled in BV → 0, even if the family has children elsewhere.
    expect(buildFamilyDashboardModel(input({ enrollments: [TABLA_ENROLLMENT] })).kidsEnrolled).toBe(0);
  });

  it('givenForPeriod counts only donations for the BV enrollment', () => {
    const m = buildFamilyDashboardModel(
      input({
        donations: [
          makeDonation(), // $300 to Tabla
          makeDonation({ eid: null, type: 'general', programKey: null, amountCAD: 50, label: 'General' }),
          makeDonation({ eid: 'CMT-AAAA-bv-brampton-2025-26', programKey: 'bala-vihar', amountCAD: 200, label: 'BV' }),
        ],
      }),
    );
    expect(m.givenForPeriod).toBe(200); // only the BV donation
    expect(m.donation.complete).toBe(true); // 200 >= 200 suggested
    expect(m.donation.tone).toBe('ok');
  });
});

describe('buildFamilyDashboardModel — no BV enrollment', () => {
  it('shows not-enrolled when the only active enrollment is non-BV', () => {
    const m = buildFamilyDashboardModel(input({ enrollments: [TABLA_ENROLLMENT] }));
    expect(m.isEnrolled).toBe(false);
    expect(m.enrollPeriodLabel).toBeNull();
    expect(m.suggestedAmount).toBeNull();
    expect(m.donation.heading).toBe('Donation');
    // General giving moved off-portal (2026-06-04): a non-BV-enrolled family has
    // no in-portal Give button.
    expect(m.donation.showGive).toBe(false);
    expect(m.enrolledPill.text).toBe('Not enrolled');
    // The model formats whatever union it's given (the page decides whether a
    // non-BV-enrolled family even computes one).
    expect(m.attendance.summary.attended).toBe(2);
    // Tabla still gets its own card.
    expect(m.otherProgramCards.map((c) => c.programKey)).toEqual(['tabla']);
  });

  it('handles an empty family (no enrollments, no check-ins)', () => {
    const m = buildFamilyDashboardModel(input({ enrollments: [], bvAttendance: resolved([]), donations: [] }));
    expect(m.isEnrolled).toBe(false);
    expect(m.attendance.hasAttendance).toBe(false);
    expect(m.donation.tone).toBeNull();
    expect(m.donation.showGive).toBe(false); // no general giving in-portal
  });
});

describe('buildFamilyDashboardModel — legacy payment bridge', () => {
  const legacyBv = makeEnrollment({ offering: { ...BV_OFFERING, paymentSource: 'legacy' } });

  it('isLegacyBvPeriod is true only for a legacy-sourced active BV offering', () => {
    expect(isLegacyBvPeriod([legacyBv])).toBe(true);
    expect(isLegacyBvPeriod([BV_ENROLLMENT])).toBe(false);
    expect(isLegacyBvPeriod([TABLA_ENROLLMENT])).toBe(false);
  });

  it('legacyPaid + Completed heading when the roster says paid', () => {
    const m = buildFamilyDashboardModel(input({ enrollments: [legacyBv], legacyPaymentStatus: 'paid' }));
    expect(m.isLegacyPeriod).toBe(true);
    expect(m.legacyPaid).toBe(true);
    expect(m.donation.heading).toBe('Completed');
    expect(m.donation.showGive).toBe(false);
    expect(m.donation.showProgress).toBe(false);
  });

  it('legacy-pending shows Payment pending and still allows giving', () => {
    const m = buildFamilyDashboardModel(input({ enrollments: [legacyBv], legacyPaymentStatus: 'pending' }));
    expect(m.legacyPaid).toBe(false);
    expect(m.donation.heading).toBe('Payment pending');
    expect(m.donation.showGive).toBe(true);
  });
});
