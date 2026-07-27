import { describe, it, expect } from 'vitest';
import type { OfferingDoc } from '../schemas/offering';
import { chargeAmount, classifyRosterPayment, type ActiveEnrollmentCharge } from '../roster-payment';

const ENROLLED = new Date('2026-09-15T12:00:00Z');

type OfferingShape = Pick<OfferingDoc, 'pricingTiers' | 'paymentSource'>;

function offering(amountCAD: number | null, paymentSource?: OfferingDoc['paymentSource']): OfferingShape {
  return {
    pricingTiers: amountCAD === null ? [] : [{ effectiveFrom: '2026-09-01', amountCAD, label: 'Full year' }],
    ...(paymentSource ? { paymentSource } : {}),
  };
}

function charge(over: Partial<ActiveEnrollmentCharge> = {}): ActiveEnrollmentCharge {
  return { override: null, snapshot: 0, offering: offering(500), enrolledAt: ENROLLED, ...over };
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

  it('treats an absent paymentSource as portal-collected', () => {
    expect(classifyRosterPayment([charge({ offering: offering(null) })], 0)).toBe('not-applicable');
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
