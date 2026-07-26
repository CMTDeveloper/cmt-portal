import { describe, it, expect } from 'vitest';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import { needsAdultClassSelection, type AdultClassGateInput } from '../needs-selection';

const ASC_OID = 'adult-study-class-brampton-2026-27';
const BV_OID = 'bala-vihar-brampton-2026-27';

function adult(mid: string, over: Partial<MemberDoc> = {}): MemberDoc {
  return {
    mid, uid: null, firstName: 'A', lastName: 'Parent', type: 'Adult',
    gender: 'PreferNotToSay', manager: false, joinedAt: new Date(), email: null, phone: null,
    schoolGrade: null, birthMonthYear: null, volunteeringSkills: [], foodAllergies: null,
    emergencyContacts: [null, null], ...over,
  } as MemberDoc;
}

function enrollment(over: Partial<EnrollmentWithOffering> & { oid: string; programKey: string }) {
  return {
    eid: `F-${over.oid}`, fid: 'F', status: 'active', enrolledMids: ['F-03'],
    effectiveSuggestedAmount: 500, offering: { paymentSource: 'portal' },
    ...over,
  } as unknown as EnrollmentWithOffering;
}

const bvPaidByDonation = { status: 'completed', eid: `F-${BV_OID}`, amountCAD: 500 };

/** A family that SHOULD be asked: manager, paid BV, no ASC enrollment, one free adult. */
function base(over: Partial<AdultClassGateInput> = {}): AdultClassGateInput {
  return {
    isManager: true,
    members: [adult('F-01'), adult('F-02')],
    enrollments: [enrollment({ oid: BV_OID, programKey: 'bala-vihar' })],
    donations: [bvPaidByDonation],
    currentOffering: { oid: ASC_OID },
    teacherAssignedMids: new Set(),
    legacyPaymentStatus: 'unknown',
    ...over,
  };
}

describe('needsAdultClassSelection - the happy path', () => {
  it('fires for a manager with a paid BV enrollment, no ASC enrollment, and a free adult', () => {
    expect(needsAdultClassSelection(base())).toBe(true);
  });
});

describe('needsAdultClassSelection - condition 0: is there an offering at all', () => {
  // THE LOCKOUT GUARD. getOpenOfferingsForFamily filters `enabled == true` and
  // drops expired offerings, so the day an admin closes registration - or the
  // launch offering lapses, or one location is missed - it returns nothing. With
  // no such offering there is no oid for condition 4 to compare against, so
  // "no active enrollment for the current term" is trivially true, the gate
  // fires, and EVERY paid Bala Vihar manager at that location is redirected to a
  // screen with nothing to enroll into and cannot reach /family at all.
  it('NEVER fires when there is no reachable adult-class offering', () => {
    expect(needsAdultClassSelection(base({ currentOffering: null }))).toBe(false);
  });

  it('does not fire on a null offering even when every other condition is met', () => {
    const input = base({ currentOffering: null, enrollments: [enrollment({ oid: BV_OID, programKey: 'bala-vihar' })] });
    expect(needsAdultClassSelection(input)).toBe(false);
  });
});

describe('needsAdultClassSelection - condition 1: manager only', () => {
  it('does not fire for a non-manager', () => {
    expect(needsAdultClassSelection(base({ isManager: false }))).toBe(false);
  });
});

describe('needsAdultClassSelection - condition 2: an active Bala Vihar enrollment', () => {
  it('does not fire with no enrollments at all (matrix row 6)', () => {
    expect(needsAdultClassSelection(base({ enrollments: [] }))).toBe(false);
  });

  it('does not fire when the BV enrollment is cancelled', () => {
    const input = base({ enrollments: [enrollment({ oid: BV_OID, programKey: 'bala-vihar', status: 'cancelled' })] });
    expect(needsAdultClassSelection(input)).toBe(false);
  });

  it('selects Bala Vihar by programKey, never "the first active enrollment"', () => {
    // A newer non-BV enrollment sorts first (getEnrollments is enrolledAt DESC).
    // Picking [0] would read Tabla's amount and miss BV entirely - the 2026-06-01
    // attendance-loss bug, in a new place.
    const input = base({
      enrollments: [
        enrollment({ oid: 'tabla-2026-27', programKey: 'tabla', effectiveSuggestedAmount: 200 }),
        enrollment({ oid: BV_OID, programKey: 'bala-vihar' }),
      ],
    });
    expect(needsAdultClassSelection(input)).toBe(true);
  });
});

describe('needsAdultClassSelection - condition 3: the BV donation is paid', () => {
  it('does not fire when nothing has been paid', () => {
    expect(needsAdultClassSelection(base({ donations: [] }))).toBe(false);
  });

  // AMOUNT IS IRRELEVANT. This is an explicit owner decision (2026-07-02,
  // issue #23), implemented by isEnrollmentConfirmed at
  // enrollment-confirmation.ts:38 and stated in its docstring: "any completed
  // donation tied to its eid ... Amount is irrelevant (donations are
  // suggestions, not fees)."
  //
  // A `>=` threshold here would systematically exempt every PARTIAL donor from
  // an org policy this whole feature exists to enforce - silently, permanently,
  // and invisibly to any test whose fixture pays in full.
  it('FIRES on a partial donation - donations are suggestions, not fees', () => {
    const input = base({ donations: [{ status: 'completed', eid: `F-${BV_OID}`, amountCAD: 50 }] });
    expect(needsAdultClassSelection(input)).toBe(true);
  });

  // A threshold would also make the gate a function of pricing edits made months
  // later: effectiveSuggestedAmount is recomputed LIVE from the current offering
  // (get-enrollments.ts:85-87), not from the pinned snapshot, so raising a tier
  // in November would retroactively un-pay a family who paid in full in
  // September. Being threshold-free is what makes that impossible.
  it('is immune to a later tier increase - a $1 donation still counts', () => {
    const input = base({
      donations: [{ status: 'completed', eid: `F-${BV_OID}`, amountCAD: 1 }],
      enrollments: [enrollment({ oid: BV_OID, programKey: 'bala-vihar', effectiveSuggestedAmount: 9999 })],
    });
    expect(needsAdultClassSelection(input)).toBe(true);
  });

  it('does not fire when the donation is not completed', () => {
    const input = base({ donations: [{ status: 'pending', eid: `F-${BV_OID}`, amountCAD: 500 }] });
    expect(needsAdultClassSelection(input)).toBe(false);
  });

  // THE TRAP the plan names: sumCompletedDonations(fid) is program-BLIND. Using
  // it here would let a Tabla or general donation satisfy the Bala Vihar amount
  // and waive a $101 fee for a family that never paid Bala Vihar.
  it('does NOT count a donation for a DIFFERENT enrollment', () => {
    const input = base({ donations: [{ status: 'completed', eid: 'F-tabla-2026-27', amountCAD: 500 }] });
    expect(needsAdultClassSelection(input)).toBe(false);
  });

  it('does NOT count a general (eid: null) donation', () => {
    const input = base({ donations: [{ status: 'completed', eid: null, amountCAD: 500 }] });
    expect(needsAdultClassSelection(input)).toBe(false);
  });

  it('counts one completed donation among several unrelated ones', () => {
    const input = base({
      donations: [
        { status: 'pending', eid: `F-${BV_OID}`, amountCAD: 500 },
        { status: 'completed', eid: 'F-tabla-2026-27', amountCAD: 500 },
        { status: 'completed', eid: `F-${BV_OID}`, amountCAD: 25 },
      ],
    });
    expect(needsAdultClassSelection(input)).toBe(true);
  });

  it('treats a LEGACY-sourced offering as paid when the legacy roster says paid', () => {
    const input = base({
      donations: [],
      enrollments: [enrollment({ oid: BV_OID, programKey: 'bala-vihar', offering: { paymentSource: 'legacy' } } as never)],
      legacyPaymentStatus: 'paid',
    });
    expect(needsAdultClassSelection(input)).toBe(true);
  });

  // THE SECOND TRAP: legacyPaid must be gated on the offering actually being
  // legacy-sourced. Ungated, a family whose 2025-26 legacy row reads `paid` is
  // treated as having paid the 2026-27 donation - contradicting spec section 2
  // ("After the BV donation") and waiving a fee they never earned.
  it('does NOT let a legacy "paid" satisfy a PORTAL-sourced offering', () => {
    const input = base({ donations: [], legacyPaymentStatus: 'paid' });
    expect(needsAdultClassSelection(input)).toBe(false);
  });

  it('treats a TEACHER-MANAGED offering as paid (those families never pay in-portal)', () => {
    const input = base({
      donations: [],
      enrollments: [enrollment({ oid: BV_OID, programKey: 'bala-vihar', offering: { paymentSource: 'teacher-managed' } } as never)],
    });
    expect(needsAdultClassSelection(input)).toBe(true);
  });
});

describe('needsAdultClassSelection - condition 4: no ASC enrollment for the CURRENT term', () => {
  it('does not fire when an active ASC enrollment already names an adult', () => {
    const input = base({
      enrollments: [
        enrollment({ oid: BV_OID, programKey: 'bala-vihar' }),
        enrollment({ oid: ASC_OID, programKey: 'adult-study-class', enrolledMids: ['F-01'] }),
      ],
    });
    expect(needsAdultClassSelection(input)).toBe(false);
  });

  // Spec section 2.1's explicit note: an enrollment whose chosen adult later left
  // the family leaves enrolledMids EMPTY, and that family still needs to choose.
  it('DOES fire when the ASC enrollment exists but names NOBODY', () => {
    const input = base({
      enrollments: [
        enrollment({ oid: BV_OID, programKey: 'bala-vihar' }),
        enrollment({ oid: ASC_OID, programKey: 'adult-study-class', enrolledMids: [] }),
      ],
    });
    expect(needsAdultClassSelection(input)).toBe(true);
  });

  it('DOES fire when the only ASC enrollment is CANCELLED', () => {
    const input = base({
      enrollments: [
        enrollment({ oid: BV_OID, programKey: 'bala-vihar' }),
        enrollment({ oid: ASC_OID, programKey: 'adult-study-class', status: 'cancelled', enrolledMids: ['F-01'] }),
      ],
    });
    expect(needsAdultClassSelection(input)).toBe(true);
  });

  // Term scoping (spec 4.6.1). Checking "any ASC enrollment ever" would silently
  // exempt every returning family after year one.
  it('DOES fire when the ASC enrollment is for a PRIOR term', () => {
    const input = base({
      enrollments: [
        enrollment({ oid: BV_OID, programKey: 'bala-vihar' }),
        enrollment({ oid: 'adult-study-class-brampton-2025-26', programKey: 'adult-study-class', enrolledMids: ['F-01'] }),
      ],
    });
    expect(needsAdultClassSelection(input)).toBe(true);
  });
});

describe('needsAdultClassSelection - condition 5: at least one eligible adult', () => {
  it('does not fire when both parents teach (matrix row 3)', () => {
    expect(needsAdultClassSelection(base({ teacherAssignedMids: new Set(['F-01', 'F-02']) }))).toBe(false);
  });

  it('does not fire for a single teaching parent (matrix row 4)', () => {
    const input = base({ members: [adult('F-01')], teacherAssignedMids: new Set(['F-01']) });
    expect(needsAdultClassSelection(input)).toBe(false);
  });

  it('fires for a single NON-teaching parent (matrix row 5)', () => {
    expect(needsAdultClassSelection(base({ members: [adult('F-01')] }))).toBe(true);
  });

  it('does not fire when the only adults are pending invitees', () => {
    const input = base({ members: [adult('F-01', { inviteStatus: 'pending' })] });
    expect(needsAdultClassSelection(input)).toBe(false);
  });
});

// Spec 2.3 requires row 7 to be asserted TWICE OVER, independently: a later
// change to either half could silently start prompting a childless teacher
// couple to enroll in a class they are teaching through.
describe('needsAdultClassSelection - matrix row 7, both halves independently', () => {
  it('fails on condition 2 alone: no BV enrollment, adults NOT teaching', () => {
    const input = base({ enrollments: [], teacherAssignedMids: new Set() });
    expect(needsAdultClassSelection(input)).toBe(false);
  });

  it('fails on condition 5 alone: BV enrollment present and paid, but every adult teaches', () => {
    const input = base({ teacherAssignedMids: new Set(['F-01', 'F-02']) });
    expect(needsAdultClassSelection(input)).toBe(false);
  });

  it('fails when BOTH hold, which is the real row 7', () => {
    const input = base({ enrollments: [], teacherAssignedMids: new Set(['F-01', 'F-02']) });
    expect(needsAdultClassSelection(input)).toBe(false);
  });
});
