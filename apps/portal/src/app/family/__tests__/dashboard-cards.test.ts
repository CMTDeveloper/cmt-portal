import { describe, it, expect } from 'vitest';
import { deriveProgramCards } from '../_helpers/derive-program-cards';
import { selectBalaViharEnrollment } from '../_helpers/select-bv-enrollment';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import type { ProgramDoc, OfferingDoc } from '@cmt/shared-domain';

// ─── Minimal fixtures ─────────────────────────────────────────────────────────

function makeOffering(overrides: Partial<OfferingDoc> = {}): OfferingDoc {
  return {
    oid: 'bv-brampton-fall-2026',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    location: 'Brampton',
    termLabel: 'Fall 2026',
    termType: 'term',
    startDate: new Date('2026-09-07'),
    endDate: new Date('2027-01-25'),
    pricingTiers: [],
    enabled: true,
    createdAt: new Date('2026-01-01'),
    createdBy: 'admin',
    updatedAt: new Date('2026-01-01'),
    updatedBy: 'admin',
    ...overrides,
  };
}

function makeEnrollment(
  overrides: Partial<EnrollmentWithOffering> = {},
): EnrollmentWithOffering {
  return {
    eid: 'CMT-AAAA-bv-brampton-fall-2026',
    fid: 'CMT-AAAA',
    oid: 'bv-brampton-fall-2026',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    termLabel: 'Fall 2026',
    location: 'Brampton',
    enrolledAt: new Date('2026-09-01'),
    enrolledVia: 'family-initiated',
    enrolledByMid: 'CMT-AAAA-01',
    enrolledMids: ['CMT-AAAA-03'],
    suggestedAmountSnapshot: 500,
    suggestedAmountOverride: null,
    status: 'active',
    cancelledAt: null,
    cancelledReason: null,
    effectiveSuggestedAmount: 500,
    offering: makeOffering(),
    ...overrides,
  };
}

function makeBvProgram(overrides: Partial<ProgramDoc> = {}): ProgramDoc {
  return {
    programKey: 'bala-vihar',
    label: 'Bala Vihar',
    shortDescription: 'Sunday school for children',
    status: 'active',
    locations: ['Brampton'],
    termType: 'term',
    eligibility: { memberType: 'child' },
    capabilities: {
      usesOfferings: true,
      usesDonation: true,
      usesLevels: true,
      usesCalendar: true,
      attendanceMode: 'check-in',
    },
    displayOrder: 0,
    createdAt: new Date('2026-01-01'),
    createdBy: 'admin',
    updatedAt: new Date('2026-01-01'),
    updatedBy: 'admin',
    ...overrides,
  };
}

function makeTablaProgram(overrides: Partial<ProgramDoc> = {}): ProgramDoc {
  return {
    programKey: 'tabla',
    label: 'Tabla',
    shortDescription: 'Rhythm and percussion for all ages',
    status: 'active',
    locations: [],
    termType: 'rolling',
    eligibility: { memberType: 'any' },
    capabilities: {
      usesOfferings: true,
      usesDonation: false,
      usesLevels: false,
      usesCalendar: false,
      attendanceMode: 'none',
    },
    displayOrder: 1,
    createdAt: new Date('2026-01-01'),
    createdBy: 'admin',
    updatedAt: new Date('2026-01-01'),
    updatedBy: 'admin',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('deriveProgramCards', () => {
  it('returns an empty array when there are no enrollments', () => {
    const cards = deriveProgramCards([], new Map());
    expect(cards).toEqual([]);
  });

  it('ignores cancelled enrollments', () => {
    const cancelled = makeEnrollment({ status: 'cancelled' });
    const cards = deriveProgramCards(
      [cancelled],
      new Map([['bala-vihar', makeBvProgram()]]),
    );
    expect(cards).toHaveLength(0);
  });

  it('BV active enrollment → showAttendance=true + showDonation=true', () => {
    const bvEnrollment = makeEnrollment();
    const cards = deriveProgramCards(
      [bvEnrollment],
      new Map([['bala-vihar', makeBvProgram()]]),
    );

    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.programKey).toBe('bala-vihar');
    expect(card.label).toBe('Bala Vihar');
    expect(card.termLabel).toBe('Fall 2026');
    expect(card.status).toBe('active');
    expect(card.showAttendance).toBe(true);
    expect(card.showDonation).toBe(true);
  });

  it('free location-less program → showAttendance=false + showDonation=false', () => {
    const tablaEnrollment = makeEnrollment({
      eid: 'CMT-AAAA-tabla-rolling-2026',
      oid: 'tabla-rolling-2026',
      programKey: 'tabla',
      programLabel: 'Tabla',
      termLabel: 'Rolling 2026',
      location: null,
      offering: makeOffering({
        oid: 'tabla-rolling-2026',
        programKey: 'tabla',
        programLabel: 'Tabla',
        location: null,
        termLabel: 'Rolling 2026',
        termType: 'rolling',
        endDate: null,
      }),
    });

    const cards = deriveProgramCards(
      [tablaEnrollment],
      new Map([['tabla', makeTablaProgram()]]),
    );

    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.programKey).toBe('tabla');
    expect(card.showAttendance).toBe(false);
    expect(card.showDonation).toBe(false);
  });

  it('multiple active enrollments → one card per enrollment, correct order', () => {
    const bvEnrollment = makeEnrollment();
    const tablaEnrollment = makeEnrollment({
      eid: 'CMT-AAAA-tabla-rolling-2026',
      oid: 'tabla-rolling-2026',
      programKey: 'tabla',
      programLabel: 'Tabla',
      termLabel: 'Rolling 2026',
      location: null,
      offering: makeOffering({
        oid: 'tabla-rolling-2026',
        programKey: 'tabla',
        programLabel: 'Tabla',
        location: null,
        termLabel: 'Rolling 2026',
        termType: 'rolling',
        endDate: null,
      }),
    });

    const programsById = new Map([
      ['bala-vihar', makeBvProgram()],
      ['tabla', makeTablaProgram()],
    ]);

    const cards = deriveProgramCards([bvEnrollment, tablaEnrollment], programsById);
    expect(cards).toHaveLength(2);
    expect(cards[0]!.programKey).toBe('bala-vihar');
    expect(cards[1]!.programKey).toBe('tabla');
  });

  it('falls back gracefully when program doc is missing from map', () => {
    // enrollment for an unknown program — should still produce a card with
    // showAttendance/showDonation=false (safe default, no capabilities known)
    const orphan = makeEnrollment({
      programKey: 'yoga',
      programLabel: 'Yoga',
      termLabel: 'Spring 2026',
    });
    const cards = deriveProgramCards([orphan], new Map());
    expect(cards).toHaveLength(1);
    expect(cards[0]!.programKey).toBe('yoga');
    expect(cards[0]!.showAttendance).toBe(false);
    expect(cards[0]!.showDonation).toBe(false);
  });
});

describe('selectBalaViharEnrollment', () => {
  it('returns null when there are no enrollments', () => {
    expect(selectBalaViharEnrollment([])).toBeNull();
  });

  it('returns null when the only active enrollment is non-BV', () => {
    const tabla = makeEnrollment({
      eid: 'CMT-AAAA-tabla-2026-27',
      oid: 'tabla-2026-27',
      programKey: 'tabla',
      programLabel: 'Tabla',
      termLabel: '2026-27',
    });
    expect(selectBalaViharEnrollment([tabla])).toBeNull();
  });

  it('picks the active Bala Vihar enrollment even when a newer non-BV one sorts first', () => {
    // getEnrollments sorts enrolledAt DESC, so a recently-added Tabla enrollment
    // comes first in the list. The BV-bespoke section must still resolve to Bala
    // Vihar — otherwise Tabla hijacks the card's term/amount and scopes
    // attendance to a window with no check-ins (the regression this guards).
    const tabla = makeEnrollment({
      eid: 'CMT-AAAA-tabla-2026-27',
      oid: 'tabla-2026-27',
      programKey: 'tabla',
      programLabel: 'Tabla',
      termLabel: '2026-27',
      enrolledAt: new Date('2026-05-30'),
    });
    const bv = makeEnrollment({
      eid: 'CMT-AAAA-bv-2025-26',
      oid: 'bv-2025-26',
      termLabel: '2025-26',
      enrolledAt: new Date('2025-09-01'),
    });

    const picked = selectBalaViharEnrollment([tabla, bv]); // Tabla first (DESC)
    expect(picked).not.toBeNull();
    expect(picked!.programKey).toBe('bala-vihar');
    expect(picked!.termLabel).toBe('2025-26');
  });

  it('ignores a cancelled Bala Vihar enrollment', () => {
    const cancelledBv = makeEnrollment({ status: 'cancelled' });
    expect(selectBalaViharEnrollment([cancelledBv])).toBeNull();
  });
});
