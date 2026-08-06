import { describe, it, expect } from 'vitest';
import type { OfferingDoc } from '../schemas/offering';
import {
  chargeAmount,
  classifyRosterPayment,
  explainRosterPayment,
  type ActiveEnrollmentCharge,
} from '../roster-payment';

const ENROLLED = new Date('2026-09-15T12:00:00Z');

type OfferingShape = Pick<OfferingDoc, 'pricingTiers' | 'paymentSource'>;

function offering(amountCAD: number | null, paymentSource?: OfferingDoc['paymentSource']): OfferingShape {
  return {
    pricingTiers: amountCAD === null ? [] : [{ effectiveFrom: '2026-09-01', amountCAD, label: 'Full year' }],
    ...(paymentSource ? { paymentSource } : {}),
  };
}

function charge(over: Partial<ActiveEnrollmentCharge> = {}): ActiveEnrollmentCharge {
  return {
    override: null,
    snapshot: 0,
    offering: offering(500),
    enrolledAt: ENROLLED,
    settledOffPortal: false,
    ...over,
  };
}

describe('chargeAmount - what one enrollment costs', () => {
  it('prices from the CURRENT offering, at the tier that applied when they enrolled', () => {
    expect(chargeAmount(charge())).toBe(500);
  });

  it('lets a per-family override win, including a waiver of 0', () => {
    expect(chargeAmount(charge({ override: 0 }))).toBe(0);
    expect(chargeAmount(charge({ override: 101 }))).toBe(101);
  });

  it('reads a free program (no pricing tiers) as costing 0', () => {
    expect(chargeAmount(charge({ offering: offering(null) }))).toBe(0);
  });

  // A price we recorded at enroll time is real knowledge, even if the offering
  // doc has since been deleted. Keeping it preserves today's paid/outstanding
  // verdict for those families rather than downgrading them to unknown.
  it('falls back to a POSITIVE enroll-time snapshot when the offering is gone', () => {
    expect(chargeAmount(charge({ offering: null, snapshot: 500 }))).toBe(500);
  });

  // THE CASE THAT MOTIVATES THE null. Every enrollment in UAT that read as a $0
  // total got there this way: the oid points at an offering doc that no longer
  // exists, so the snapshot of 0 is not "this is free" - it is "nobody ever
  // wrote a price here". Returning 0 would make the two indistinguishable and
  // let a family we cannot price be reported as owing nothing.
  it('returns null - NOT 0 - when the offering is gone and the snapshot is 0', () => {
    expect(chargeAmount(charge({ offering: null, snapshot: 0 }))).toBeNull();
  });

  // An explicit override outranks the missing offering: staff stated the price.
  it('trusts an override of 0 even when the offering is gone', () => {
    expect(chargeAmount(charge({ offering: null, snapshot: 0, override: 0 }))).toBe(0);
  });
});

describe('classifyRosterPayment - money was expected', () => {
  it('is unknown for a family with no active enrollments', () => {
    expect(classifyRosterPayment([], 0)).toBe('unknown');
    expect(classifyRosterPayment([], 500)).toBe('unknown');
  });

  // N=2: the total is summed across BOTH, never taken from the first.
  it('sums every active enrollment before comparing', () => {
    const active = [charge(), charge({ offering: offering(300) })];
    expect(classifyRosterPayment(active, 800)).toBe('paid');
    expect(classifyRosterPayment(active, 799)).toBe('outstanding');
  });

  it('counts an exact payment as paid', () => {
    expect(classifyRosterPayment([charge()], 500)).toBe('paid');
  });

  it('counts an overpayment as paid', () => {
    expect(classifyRosterPayment([charge()], 501)).toBe('paid');
  });
});

describe('classifyRosterPayment - nothing is owed (N/A)', () => {
  it('reads a free program as N/A, not unknown', () => {
    expect(classifyRosterPayment([charge({ offering: offering(null) })], 0)).toBe('not-applicable');
  });

  // THE CASE TASK 11 EXISTS FOR. A Bala Vihar family is waived into the adult
  // study class (override 0); Bala Vihar is later cancelled, leaving the waived
  // class as their only active enrollment. They owe nothing - that is settled,
  // not unknown.
  it('reads a lone waived enrollment as N/A', () => {
    expect(classifyRosterPayment([charge({ override: 0 })], 0)).toBe('not-applicable');
  });

  it('reads two free enrollments as N/A', () => {
    const active = [charge({ offering: offering(null) }), charge({ override: 0 })];
    expect(classifyRosterPayment(active, 0)).toBe('not-applicable');
  });

  // N=2 the other way: a single priced enrollment beside a free one still owes
  // money, so the free one must not drag the verdict to N/A.
  it('is NOT N/A when a free enrollment sits beside a priced one', () => {
    const active = [charge({ offering: offering(null) }), charge()];
    expect(classifyRosterPayment(active, 0)).toBe('outstanding');
    expect(classifyRosterPayment(active, 500)).toBe('paid');
  });

  // Paid means money arrived. A family who never owed anything never paid
  // anything, and telling a volunteer they are "Paid" implies a transaction
  // that did not happen.
  it('never reports a $0 family as paid, however much they donated', () => {
    expect(classifyRosterPayment([charge({ override: 0 })], 1000)).toBe('not-applicable');
  });
});

describe('classifyRosterPayment - we cannot tell (unknown)', () => {
  it('is unknown when the only enrollment cannot be priced', () => {
    expect(classifyRosterPayment([charge({ offering: null, snapshot: 0 })], 0)).toBe('unknown');
  });

  // N=2, and the load-bearing half: ONE unpriceable enrollment poisons the whole
  // verdict. Without this the family reads 'paid' off the priced enrollment
  // while a program we know nothing about sits beside it.
  it('is unknown when ANY of two enrollments cannot be priced', () => {
    const active = [charge(), charge({ offering: null, snapshot: 0 })];
    expect(classifyRosterPayment(active, 500)).toBe('unknown');
    expect(classifyRosterPayment(active, 0)).toBe('unknown');
  });

  // A teacher-managed offering's fee is collected in cash by the teacher and
  // never recorded here. A zero total therefore means "the portal has no
  // opinion", NOT "nothing is owed" - the one case where N/A would actively
  // mislead a volunteer into thinking a family was settled.
  it('is unknown for an unpriced teacher-managed offering, not N/A', () => {
    const active = [charge({ offering: offering(null, 'teacher-managed') })];
    expect(classifyRosterPayment(active, 0)).toBe('unknown');
  });

  it('is unknown even when staff waived an unpriced teacher-managed offering', () => {
    const active = [charge({ override: 0, offering: offering(null, 'teacher-managed') })];
    expect(classifyRosterPayment(active, 0)).toBe('unknown');
  });

  // Unchanged behaviour, pinned so this task cannot quietly move it: a
  // teacher-managed offering that DOES carry a price still reads outstanding,
  // because portal donations never arrive for it. Worth revisiting on its own,
  // but not here - changing it would move real families' chips.
  it('leaves a PRICED teacher-managed offering reading outstanding', () => {
    const active = [charge({ offering: offering(300, 'teacher-managed') })];
    expect(classifyRosterPayment(active, 0)).toBe('outstanding');
  });

  // 'legacy' is the OTHER off-portal source: its payment status lives in the prod
  // RTDB roster (offering.ts:22), which this classifier never reads. Same argument
  // as teacher-managed, and reachable - CreateOfferingSchema puts no floor on
  // pricingTiers, so an admin can create a legacy offering with no price at all.
  it('is unknown for an unpriced LEGACY offering, not N/A', () => {
    const active = [charge({ offering: offering(null, 'legacy') })];
    expect(classifyRosterPayment(active, 0)).toBe('unknown');
  });

  // N=2: one off-portal enrollment is enough, even beside a portal-free one.
  it('is unknown when ANY of two zero-cost enrollments is off-portal', () => {
    const active = [charge({ offering: offering(null) }), charge({ offering: offering(null, 'legacy') })];
    expect(classifyRosterPayment(active, 0)).toBe('unknown');
  });

  it('treats an absent paymentSource as portal-collected', () => {
    expect(classifyRosterPayment([charge({ offering: offering(null) })], 0)).toBe('not-applicable');
  });

  // A deliberate edge, pinned so it is a decision rather than an accident: with
  // no offering doc there is no source to read, but an override of 0 is an
  // explicit human statement that this family owes nothing. The statement wins.
  // Reaching here at all needs a staff override on an enrollment whose offering
  // was later deleted.
  it('honours an override of 0 as N/A even with no offering to read a source from', () => {
    expect(classifyRosterPayment([charge({ override: 0, offering: null })], 0)).toBe('not-applicable');
  });
});

describe('classifyRosterPayment - corrupt totals must not read as settled', () => {
  // Unreachable through any validated write path (amountCAD is int().min(1) and
  // suggestedAmountOverride is int().nonnegative()), but get-enrollments casts
  // raw Firestore data without parsing it, so a corrupt doc can reach here. The
  // point is only that garbage must never come out the "nothing is owed" door.
  it('is unknown for a negative total', () => {
    expect(classifyRosterPayment([charge({ override: -500 })], 0)).toBe('unknown');
  });

  it('is unknown for a NaN total', () => {
    expect(classifyRosterPayment([charge({ override: Number.NaN })], 0)).toBe('unknown');
  });

  it('is unknown when a NaN sits beside a real price', () => {
    const active = [charge(), charge({ override: Number.NaN })];
    expect(classifyRosterPayment(active, 500)).toBe('unknown');
  });
});

// ── Settled outside the portal (2026-08-04) ──────────────────────────────────
//
// The production defect these pin: an admin marked a real family as already
// paying CMT by a long-standing pre-authorized debit, and the welcome roster
// answered "N/A" and dropped them out of the Paid filter. The settlement was
// being stored as the same `override: 0` the Adult Study Class waiver uses, so
// no reader could tell "we collect this elsewhere" from "nobody owes anything".
describe('classifyRosterPayment - settled outside the portal', () => {
  it('reads an admin-settled enrollment as PAID, not N/A', () => {
    expect(classifyRosterPayment([charge({ override: 0, settledOffPortal: true })], 0)).toBe('paid');
  });

  // The other half of the same distinction. If this ever starts returning
  // 'paid', the flag has stopped carrying the meaning and we are back to one
  // value with two jobs.
  it('still reads the waiver - the identical 0, without the flag - as N/A', () => {
    expect(classifyRosterPayment([charge({ override: 0 })], 0)).toBe('not-applicable');
  });

  // N=2. A settlement answers for its own enrollment and nothing else.
  it('does not settle the enrollment sitting NEXT to it', () => {
    const active = [charge({ override: 0, settledOffPortal: true }), charge()];
    expect(classifyRosterPayment(active, 0)).toBe('outstanding');
  });

  it('is paid when a settled enrollment sits beside a waived one', () => {
    const active = [charge({ override: 0, settledOffPortal: true }), charge({ override: 0 })];
    expect(classifyRosterPayment(active, 0)).toBe('paid');
  });

  // The cautious verdict still wins. Teacher-managed money is collected where
  // this function cannot see it, so "Paid" would tell a volunteer the whole
  // family is square on the strength of one enrollment that is.
  it('stays unknown when an off-portal-SOURCE enrollment sits beside the settled one', () => {
    const active = [
      charge({ override: 0, settledOffPortal: true }),
      charge({ override: 0, offering: offering(0, 'teacher-managed') }),
    ];
    expect(classifyRosterPayment(active, 0)).toBe('unknown');
  });
});

// ── explainRosterPayment - the arithmetic behind the one-word verdict ────────
//
// The verdict alone is what the welcome desk has had until now, and it is why
// Vaibhav ends up in the Stripe dashboard: `unknown` is reachable FOUR distinct
// ways and the chip cannot say which. (Four, not five - an earlier draft of this
// header counted the non-finite and negative totals as separate causes, but they
// share one branch and one reason, `corrupt-total`.) A volunteer told "Unknown" has learned
// nothing they can act on or repeat back to the family on the phone.
//
// `classifyRosterPayment` delegates here, so the explanation cannot drift from
// the verdict it explains - that one-predicate property is the whole reason
// this is not a second function computing the same thing beside it.
describe('explainRosterPayment - why, not just what', () => {
  it('agrees with classifyRosterPayment on every case that file already pins', () => {
    // The delegation, asserted rather than assumed. If someone re-implements
    // the classifier body instead of delegating, this is what fails.
    const cases: ReadonlyArray<readonly [ActiveEnrollmentCharge[], number]> = [
      [[], 0],
      [[charge()], 500],
      [[charge()], 0],
      [[charge({ override: 0 })], 0],
      [[charge({ offering: null, snapshot: 0 })], 0],
      [[charge({ override: 0, offering: offering(0, 'teacher-managed') })], 0],
      [[charge({ override: 0, settledOffPortal: true })], 0],
      [[charge(), charge({ override: 250 })], 750],
    ];
    for (const [active, paid] of cases) {
      expect(explainRosterPayment(active, paid).verdict).toBe(classifyRosterPayment(active, paid));
    }
  });

  it('reports the expected total so the desk can say what was owed', () => {
    const r = explainRosterPayment([charge(), charge({ override: 250 })], 100);
    expect(r.verdict).toBe('outstanding');
    expect(r.expectedCAD).toBe(750);
    expect(r.unknownReason).toBeNull();
  });

  it('names an EMPTY roster as the reason, not a priced total', () => {
    const r = explainRosterPayment([], 0);
    expect(r.verdict).toBe('unknown');
    expect(r.unknownReason).toBe('no-active-enrollment');
    // Not 0 - a family with no enrollment owes nothing *known*, and printing
    // "$0 expected" beside "Unknown" is the contradiction this whole change
    // exists to avoid.
    expect(r.expectedCAD).toBeNull();
  });

  it('names the UNPRICEABLE enrollment as the reason and refuses a total', () => {
    const r = explainRosterPayment([charge(), charge({ offering: null, snapshot: 0 })], 0);
    expect(r.verdict).toBe('unknown');
    expect(r.unknownReason).toBe('unpriceable-enrollment');
    expect(r.expectedCAD).toBeNull();
  });

  it('names an OFF-PORTAL program as the reason, which is a different fix', () => {
    // Distinct from unpriceable on purpose: this family IS priced (at 0), and
    // the money is collected somewhere the portal cannot see. "Ask the teacher"
    // and "this enrollment has no price" send staff to different places.
    const r = explainRosterPayment(
      [charge({ override: 0, offering: offering(0, 'teacher-managed') })],
      0,
    );
    expect(r.verdict).toBe('unknown');
    expect(r.unknownReason).toBe('off-portal-program');
    expect(r.expectedCAD).toBe(0);
  });

  it('names a CORRUPT total rather than reporting it', () => {
    const r = explainRosterPayment([charge({ override: Number.NaN })], 0);
    expect(r.verdict).toBe('unknown');
    expect(r.unknownReason).toBe('corrupt-total');
    expect(r.expectedCAD).toBeNull();
  });

  it('leaves unknownReason null on every verdict that is NOT unknown (N=4)', () => {
    expect(explainRosterPayment([charge()], 500).unknownReason).toBeNull();
    expect(explainRosterPayment([charge()], 0).unknownReason).toBeNull();
    expect(explainRosterPayment([charge({ override: 0 })], 0).unknownReason).toBeNull();
    expect(
      explainRosterPayment([charge({ override: 0, settledOffPortal: true })], 0).unknownReason,
    ).toBeNull();
  });
});
