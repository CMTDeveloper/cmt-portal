import { describe, it, expect } from 'vitest';
import {
  buildFamilyDashboardModel,
  isLegacyBvPeriod,
  type DashboardModelInput,
} from '../_helpers/dashboard-model';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import type { DonationDoc, ProgramDoc, OfferingDoc } from '@cmt/shared-domain';

// ─── Fixtures ───────────────────────────────────────────────────────────────
// Mirrors the real UAT scenario that produced the BV-pinning bug: a family
// enrolled in both Bala Vihar 2025-26 and (more recently) Tabla 2026-27. The BV
// card / donation must stay pinned to the BV enrollment, never the newer Tabla.

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
    legacyPaymentStatus: null,
    bvAttendedCount: 0, // no attendance unless a test seeds it (issue #23)
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

  it('names Bala Vihar in the donation heading for the enrolled states (#5)', () => {
    // Enrolled, nothing given yet → the pending heading must name Bala Vihar so
    // the family knows what the contribution is for.
    const pending = buildFamilyDashboardModel(input());
    expect(pending.donation.heading).toBe('Bala Vihar donation pending');
    // Enrolled + paid in full → positive heading (Bala Vihar context lives in
    // the surrounding card copy).
    const paid = buildFamilyDashboardModel(
      input({
        donations: [makeDonation({ eid: 'CMT-AAAA-bv-brampton-2025-26', programKey: 'bala-vihar', amountCAD: 200, label: 'BV' })],
      }),
    );
    expect(paid.donation.heading).toBe('Thank you for your donation');
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
    expect(m.donation.heading).toBe('Bala Vihar donation');
    // General giving moved off-portal (2026-06-04): a non-BV-enrolled family has
    // no in-portal Give button.
    expect(m.donation.showGive).toBe(false);
    expect(m.enrolledPill.text).toBe('Not enrolled');
    // Tabla still gets its own card.
    expect(m.otherProgramCards.map((c) => c.programKey)).toEqual(['tabla']);
  });

  it('handles an empty family (no enrollments)', () => {
    const m = buildFamilyDashboardModel(input({ enrollments: [], donations: [] }));
    expect(m.isEnrolled).toBe(false);
    expect(m.donation.tone).toBeNull();
    expect(m.donation.showGive).toBe(false); // no general giving in-portal
  });
});

describe('buildFamilyDashboardModel — legacy payment bridge', () => {
  const legacyBv = makeEnrollment({ offering: { ...BV_OFFERING, paymentSource: 'legacy' } });
  const teacherManagedBv = makeEnrollment({ offering: { ...BV_OFFERING, paymentSource: 'teacher-managed' } });

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

  it('legacy-pending shows Bala Vihar payment pending and still allows giving', () => {
    const m = buildFamilyDashboardModel(input({ enrollments: [legacyBv], legacyPaymentStatus: 'pending' }));
    expect(m.legacyPaid).toBe(false);
    expect(m.donation.heading).toBe('Bala Vihar payment pending');
    expect(m.donation.showGive).toBe(true);
  });

  it('teacher-managed payment does not show the in-portal Give button', () => {
    const m = buildFamilyDashboardModel(input({ enrollments: [teacherManagedBv], legacyPaymentStatus: null }));
    expect(m.isLegacyPeriod).toBe(false);
    expect(m.legacyPaid).toBe(false);
    expect(m.donation.heading).toBe('Payment managed by teacher');
    expect(m.donation.showGive).toBe(false);
    expect(m.donation.showProgress).toBe(false);
    // Surfaced to the dashboard so the status chip shows a neutral "Off-portal",
    // not a red "Pending" (payment is collected by the teacher off-portal).
    expect(m.teacherManaged).toBe(true);
  });

  it('a portal-managed BV offering is not teacher-managed', () => {
    const m = buildFamilyDashboardModel(input({ enrollments: [BV_ENROLLMENT], legacyPaymentStatus: null }));
    expect(m.teacherManaged).toBe(false);
  });
});

describe('bvState (issue #23 engagement rule)', () => {
  // "Enrolled" now means *engaged*: an active BV enrollment doc is only enough
  // for 'registered'. Confirmation requires attendance, a completed donation for
  // its eid, or legacy-paid. Reuses the file's existing fixture builders.
  const bvDonation = makeDonation({
    eid: 'CMT-AAAA-bv-brampton-2025-26',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    amountCAD: 200,
    label: 'BV',
  });
  const legacyBv = makeEnrollment({ offering: { ...BV_OFFERING, paymentSource: 'legacy' } });
  // Slice 1 (2026-07-06): a 'family-initiated'/'first-attendance' enrollment now
  // confirms on its own, so a still-Registered fixture must be a rollover
  // carry-forward ('promotion') with zero engagement. Overrides the makeEnrollment
  // default of 'family-initiated'.
  const promotedBv = makeEnrollment({ enrolledVia: 'promotion' });

  it('active BV + attendance → enrolled', () => {
    const m = buildFamilyDashboardModel(input({ bvAttendedCount: 1 }));
    expect(m.bvState).toBe('enrolled');
    expect(m.enrolledPill.text).toBe('Enrolled');
    expect(m.confirmNudge).toBe(false);
  });

  it('active BV + completed donation for its eid → enrolled', () => {
    const m = buildFamilyDashboardModel(input({ donations: [bvDonation], bvAttendedCount: 0 }));
    expect(m.bvState).toBe('enrolled');
    expect(m.confirmNudge).toBe(false);
  });

  it('active BV + neither → registered, amber pill, nudge on', () => {
    const m = buildFamilyDashboardModel(input({ enrollments: [TABLA_ENROLLMENT, promotedBv], bvAttendedCount: 0 }));
    expect(m.bvState).toBe('registered');
    expect(m.enrolledPill.text).toBe('Registered');
    // Amber "not-yet-confirmed" chip — same warn-soft/warn pair as the prasad
    // "Proposed" and attendance "Late" chips.
    expect(m.enrolledPill.bg).toBe('var(--setu-warn-soft)');
    expect(m.enrolledPill.fg).toBe('var(--warn, #a06410)');
    expect(m.confirmNudge).toBe(true);
    expect(m.isEnrolled).toBe(true); // doc-exists semantics unchanged
  });

  it('no active BV enrollment → none', () => {
    const m = buildFamilyDashboardModel(input({ enrollments: [TABLA_ENROLLMENT], bvAttendedCount: 0 }));
    expect(m.bvState).toBe('none');
    expect(m.enrolledPill.text).toBe('Not enrolled');
    expect(m.confirmNudge).toBe(false);
  });

  it('legacyPaid confirms a legacy-period enrollment', () => {
    const m = buildFamilyDashboardModel(
      input({ enrollments: [legacyBv], legacyPaymentStatus: 'paid', bvAttendedCount: 0 }),
    );
    expect(m.bvState).toBe('enrolled');
  });

  it('N=2: a completed TABLA donation does not confirm BV', () => {
    const m = buildFamilyDashboardModel(
      input({ enrollments: [TABLA_ENROLLMENT, promotedBv], donations: [makeDonation()], bvAttendedCount: 0 }),
    );
    expect(m.bvState).toBe('registered');
  });
});

describe('actionItems — donation is NOT an action item in Slice 1 (lives in the BV section)', () => {
  // Owner decision 2026-07-03: the BV donation is surfaced ONLY by the Bala Vihar
  // section's "Complete donation" button, never as an Action Item — so an
  // enrolled-unpaid family is not double-prompted. actionItems stays an empty
  // extensibility seam (Slice 2 adds the disclaimers item). These cases guard
  // that no donation item leaks back in.
  it('enrolled + portal-managed + unpaid → NO donation action item (BV section owns it)', () => {
    const model = buildFamilyDashboardModel({
      enrollments: [BV_ENROLLMENT], donations: [], programsById: new Map(),
      legacyPaymentStatus: null, bvAttendedCount: 0,
    });
    expect(model.actionItems).toEqual([]);
  });
  it('has no action item once the donation is complete', () => {
    const paid = makeDonation({ eid: BV_ENROLLMENT.eid, status: 'completed', amountCAD: 1000 });
    const model = buildFamilyDashboardModel({
      enrollments: [BV_ENROLLMENT], donations: [paid], programsById: new Map(),
      legacyPaymentStatus: null, bvAttendedCount: 0,
    });
    expect(model.actionItems).toEqual([]);
  });
  it('has no action item when not enrolled', () => {
    const model = buildFamilyDashboardModel({
      enrollments: [], donations: [], programsById: new Map(),
      legacyPaymentStatus: null, bvAttendedCount: 0,
    });
    expect(model.actionItems).toEqual([]);
  });
});
