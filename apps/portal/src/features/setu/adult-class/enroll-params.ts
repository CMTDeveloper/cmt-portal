import type { MemberDoc } from '@cmt/shared-domain/setu';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import { selectBalaViharEnrollment } from '@/app/family/_helpers/select-bv-enrollment';
import { selectableAdults } from './selectable-adults';

export interface AdultClassEnrollParams {
  /** The non-teaching, non-pending adults. Never "every Adult". */
  enrolledMids: string[];
  membershipMode: 'manual';
  /**
   * `null` means **do not supply an override at all** - leave whatever is
   * stored. Distinguished from `{ suggestedAmountOverride: null }`, which
   * actively writes "no override".
   */
  waiver: { suggestedAmountOverride: number | null } | null;
  /**
   * The override that will be IN FORCE after this call - the waiver's value when
   * one is supplied, otherwise the one already stored.
   *
   * The route must report this as the amount owed, NOT
   * `result.suggestedAmountSnapshot`. `enroll-cta.tsx:85-88` reads the response's
   * `suggestedAmount` and, when it is >= 1, sends the family STRAIGHT to Stripe
   * at that number - so returning the pinned 101 snapshot while writing an
   * override of 0 would waive the record and charge the family anyway. The fee
   * waiver is not closed until the amount the client is told matches it.
   */
  overrideInForce: number | null;
}

/**
 * What the GENERIC enroll route must pass when the offering is the Adult Study
 * Class, so the two doors into this program cannot disagree.
 *
 * `/family/enroll/adult-study-class` calls the same `enrollFamily` as the
 * bespoke `/adult-class` screen, but with none of these arguments - so today it
 * bills a Bala Vihar family **$101**, auto-enrolls **every** Adult (teachers and
 * pending invitees included, violating spec 4.4), leaves `membershipMode: 'auto'`
 * so the next member edit re-adds everyone, and - because `enrolledMids` ends up
 * non-empty - satisfies the gate's condition 4, so the family never even sees
 * the selection screen. The more discoverable door is the broken one.
 *
 * PURE. The caller does the I/O.
 */
export function resolveAdultClassEnrollParams(
  input: {
    members: readonly MemberDoc[];
    enrollments: EnrollmentWithOffering[];
    teacherAssignedMids: ReadonlySet<string>;
  },
  oid: string,
): AdultClassEnrollParams {
  const enrolledMids = selectableAdults(input.members, input.teacherAssignedMids).map((m) => m.mid);

  // ── THE WAIVER TRACKS BALA VIHAR MEMBERSHIP, NOT PAYMENT ──────────────────
  // Deliberate, and the opposite of the gate's condition 3. They answer
  // different questions: the gate asks "should we PROMPT this family yet?",
  // where prompting an unpaid family is premature; this asks "should we BILL
  // them?", where charging $101 for a class included with Bala Vihar is wrong
  // whether or not the payment has landed yet.
  //
  // The plan (Step 3c) offered blocking the enroll while Bala Vihar is unpaid as
  // the alternative. REJECTED, because `isBalaViharPaid` carries a documented
  // FALSE NEGATIVE: a legacy-paid family whose offering doc is missing reads as
  // unpaid (`needs-selection.ts`, "KNOWN LIMIT, accepted"). Inside the gate that
  // costs them an un-asked question - benign, and explicitly the safe direction.
  // Turned into a block it would REFUSE a family who genuinely paid. Waiving on
  // membership inverts the error: the worst case is a family who enrolls in Bala
  // Vihar, never pays, and gets the adult class free - while still owing the Bala
  // Vihar donation, visibly, on the staff roster. A benign false positive beats a
  // harmful false negative.
  const hasBalaVihar = selectBalaViharEnrollment(input.enrollments) !== null;

  // ── CREATE-ONLY (Step 3b) ────────────────────────────────────────────────
  // `enrollFamily`'s reconcile rewrites any field the caller supplies, so
  // supplying an override unconditionally would let a LATER re-POST retroactively
  // zero a $101 the family has already PAID: enroll childless at $101, pay, add a
  // child, enroll in Bala Vihar, re-POST the adult-class oid, and the amount they
  // owed becomes 0. Deviation 1 says retroactive exemption is NOT implemented.
  // So once an override is stored, this never touches it again.
  const existing = input.enrollments.find((e) => e.status === 'active' && e.oid === oid);
  const alreadyPriced = existing != null && existing.suggestedAmountOverride != null;

  const waiver = alreadyPriced ? null : { suggestedAmountOverride: hasBalaVihar ? 0 : null };

  return {
    enrolledMids,
    // Freezes the selection against the member-edit prune, exactly as the
    // bespoke route does - otherwise the next edit re-derives "every adult".
    membershipMode: 'manual',
    waiver,
    overrideInForce: waiver
      ? waiver.suggestedAmountOverride
      : (existing?.suggestedAmountOverride ?? null),
  };
}
