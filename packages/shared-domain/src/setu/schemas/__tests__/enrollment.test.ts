import { describe, it, expect } from 'vitest';
import { EnrollmentDocSchema, PostEnrollmentBodySchema, OverrideEnrollmentBodySchema } from '../enrollment';

const base = {
  eid: 'e1', fid: 'f1', oid: 'bala-vihar-brampton-2025-26', programKey: 'bala-vihar',
  programLabel: 'Bala Vihar', termLabel: '2025-26', location: 'Brampton',
  enrolledAt: new Date(), enrolledVia: 'family-initiated', enrolledByMid: 'f1-01',
  enrolledMids: ['f1-02'], suggestedAmountSnapshot: 500, suggestedAmountOverride: null,
  status: 'active', cancelledAt: null, cancelledReason: null,
};
describe('EnrollmentDoc', () => {
  it('accepts oid + enrolledMids + null location', () => {
    expect(EnrollmentDocSchema.safeParse(base).success).toBe(true);
    expect(EnrollmentDocSchema.safeParse({ ...base, location: null }).success).toBe(true);
  });
});
describe('EnrollmentDocSchema.enrolledVia', () => {
  it("accepts 'kiosk' as an enrolledVia value", () => {
    const parsed = EnrollmentDocSchema.parse({ ...base, enrolledVia: 'kiosk' });
    expect(parsed.enrolledVia).toBe('kiosk');
  });
});
describe('PostEnrollmentBodySchema', () => {
  it('requires oid (was pid)', () => {
    expect(PostEnrollmentBodySchema.safeParse({ oid: 'x' }).success).toBe(true);
    expect(PostEnrollmentBodySchema.safeParse({ pid: 'x' }).success).toBe(false);
  });
});

// The Adult Study Class fee rule (P4 spec 4.2): a family that has paid its Bala
// Vihar donation pays NOTHING for the adult class. That exemption is persisted
// as `suggestedAmountOverride: 0` at enroll time, so `positive()` made the whole
// rule unrepresentable - the confirmed bug at spec section 5.
describe('EnrollmentDocSchema.suggestedAmountOverride', () => {
  it('accepts 0 — the Bala-Vihar-paid exemption', () => {
    const parsed = EnrollmentDocSchema.parse({ ...base, suggestedAmountOverride: 0 });
    expect(parsed.suggestedAmountOverride).toBe(0);
  });

  it('still accepts null (no override) and a positive amount', () => {
    expect(EnrollmentDocSchema.safeParse({ ...base, suggestedAmountOverride: null }).success).toBe(true);
    expect(EnrollmentDocSchema.safeParse({ ...base, suggestedAmountOverride: 250 }).success).toBe(true);
  });

  it('still REJECTS a negative override', () => {
    // Relaxing positive() to nonnegative() must not open the door to a negative
    // expected amount, which would read as the org owing the family money.
    expect(EnrollmentDocSchema.safeParse({ ...base, suggestedAmountOverride: -1 }).success).toBe(false);
  });

  it('still rejects a non-integer override', () => {
    expect(EnrollmentDocSchema.safeParse({ ...base, suggestedAmountOverride: 10.5 }).success).toBe(false);
  });
});

describe('OverrideEnrollmentBodySchema', () => {
  // 2026-08-03: `note` became REQUIRED. Every case below carries one, because
  // the amount rules and the note rule are independent and a fixture that
  // omitted it would only ever prove the note rule.
  const note = 'Existing pre-authorized debit with CMT';

  // Same relaxation on the write side. This WIDENS the welcome-team
  // PATCH /api/welcome/enrollments/[eid]/override contract: staff can now zero
  // an override deliberately, which previously 400'd.
  it('accepts 0 so staff can zero an override deliberately', () => {
    expect(OverrideEnrollmentBodySchema.safeParse({ suggestedAmountOverride: 0, note }).success).toBe(true);
  });

  it('accepts null and a positive amount', () => {
    expect(OverrideEnrollmentBodySchema.safeParse({ suggestedAmountOverride: null, note }).success).toBe(true);
    expect(OverrideEnrollmentBodySchema.safeParse({ suggestedAmountOverride: 750, note }).success).toBe(true);
  });

  it('still rejects a negative amount', () => {
    expect(OverrideEnrollmentBodySchema.safeParse({ suggestedAmountOverride: -50, note }).success).toBe(false);
  });

  // ── The note (2026-08-03) ─────────────────────────────────────────────────
  //
  // This route decides whether a family is asked for $500. The audit row is the
  // justification for allowing it at all, and the note is the only part of that
  // row a human can actually learn from a year later. So the schema - not the
  // form - is where it is enforced: a UI-only rule is not a rule.
  it('REJECTS a body with no note at all', () => {
    expect(OverrideEnrollmentBodySchema.safeParse({ suggestedAmountOverride: 0 }).success).toBe(false);
  });

  it('rejects the ways a required string gets defeated in practice', () => {
    // Empty, whitespace-only, and too short to mean anything. `.trim()` runs
    // before `.min(3)`, so "  " has length 0 by the time the check happens.
    for (const bad of ['', '   ', 'x', 'ok']) {
      expect(
        OverrideEnrollmentBodySchema.safeParse({ suggestedAmountOverride: 0, note: bad }).success,
        `note ${JSON.stringify(bad)} should be rejected`,
      ).toBe(false);
    }
  });

  it('trims the stored note, so padding cannot smuggle in a blank-looking reason', () => {
    const parsed = OverrideEnrollmentBodySchema.parse({
      suggestedAmountOverride: 0,
      note: '   paid by cheque   ',
    });
    expect(parsed.note).toBe('paid by cheque');
  });

  it('rejects an essay - the row lands in a Firestore document', () => {
    expect(
      OverrideEnrollmentBodySchema.safeParse({ suggestedAmountOverride: 0, note: 'a'.repeat(501) }).success,
    ).toBe(false);
    expect(
      OverrideEnrollmentBodySchema.safeParse({ suggestedAmountOverride: 0, note: 'a'.repeat(500) }).success,
    ).toBe(true);
  });
});

// P4 spec 4.3b step 1. `manual` freezes enrolledMids against the member-edit
// auto-prune, so a family's chosen adult is not silently replaced.
describe('EnrollmentDocSchema.membershipMode', () => {
  it('accepts manual and auto', () => {
    expect(EnrollmentDocSchema.parse({ ...base, membershipMode: 'manual' }).membershipMode).toBe('manual');
    expect(EnrollmentDocSchema.parse({ ...base, membershipMode: 'auto' }).membershipMode).toBe('auto');
  });

  it('is OPTIONAL with no default — every pre-existing doc lacks it', () => {
    // Bare .optional(), never .default(): doc schemas validate on READ, and the
    // repo has been burned by a write-schema default erasing a field for partial
    // writers. Absence is read as 'auto' by the consumer, not by the schema.
    const parsed = EnrollmentDocSchema.parse(base);
    expect(parsed.membershipMode).toBeUndefined();
    expect('membershipMode' in parsed).toBe(false);
  });

  it('rejects an unknown mode', () => {
    expect(EnrollmentDocSchema.safeParse({ ...base, membershipMode: 'frozen' }).success).toBe(false);
  });
});
