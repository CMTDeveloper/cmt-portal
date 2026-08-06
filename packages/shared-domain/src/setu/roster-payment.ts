import { paymentSourceOf, resolveSuggestedAmount } from './schemas/offering';
import type { OfferingDoc, PaymentSource } from './schemas/offering';
import type { RosterPayment } from './roster';

/**
 * One ACTIVE enrollment, reduced to exactly what the payment verdict depends on.
 *
 * The raw pieces are passed in rather than a pre-summed total, deliberately.
 * Every caller used to compute `expected` itself with its own copy of the
 * fallback chain, which is how the two ways a total can reach zero - "this is
 * free" and "we never found a price" - became indistinguishable at the point of
 * classification.
 */
export interface ActiveEnrollmentCharge {
  /** The per-family override. Authoritative when present; 0 means waived. */
  override: number | null;
  /** The amount pinned at enroll time. Only trusted when positive - see below. */
  snapshot: number;
  /** The offering doc, or null when it could not be loaded. */
  offering: Pick<OfferingDoc, 'pricingTiers' | 'paymentSource'> | null;
  /** Selects the pricing tier that applied when the family enrolled. */
  enrolledAt: Date;
  /**
   * An admin has recorded that this enrollment is settled outside the portal.
   *
   * REQUIRED, not optional-with-a-default, so the compiler names every caller
   * that builds a charge. There are five, in three packages; a defaulted field
   * would have let four of them keep the old verdict silently.
   */
  settledOffPortal: boolean;
}

/**
 * What this enrollment costs, or `null` when that cannot be determined.
 *
 * The order is override → live offering → enroll-time snapshot, matching
 * `getEnrollments`' `effectiveSuggestedAmount`, with ONE deliberate difference:
 * a snapshot of 0 with no offering doc resolves to `null`, not 0. Nothing ever
 * wrote a price there, so reading it as "free" would let a family we cannot
 * price be reported as owing nothing. A *positive* snapshot is real recorded
 * knowledge and is still honoured.
 */
export function chargeAmount(charge: ActiveEnrollmentCharge): number | null {
  if (charge.override !== null) return charge.override;
  if (charge.offering) return resolveSuggestedAmount(charge.offering, charge.enrolledAt);
  return charge.snapshot > 0 ? charge.snapshot : null;
}

/**
 * `paymentSourceOf` through the repo's standard exactOptionalPropertyTypes
 * guard — `OfferingDoc['paymentSource']` includes `undefined`, its parameter
 * does not. Routed through the shared helper rather than defaulting inline so
 * there is still only one definition of "unset means portal".
 */
function sourceOf(offering: ActiveEnrollmentCharge['offering']): PaymentSource {
  return paymentSourceOf(
    offering?.paymentSource !== undefined ? { paymentSource: offering.paymentSource } : {},
  );
}

/**
 * Why a verdict came out `unknown`.
 *
 * There are four distinct routes to that one word, and they send staff to four
 * different places: nobody is enrolled / a program has no price on record / the
 * money is collected somewhere we cannot see / the stored numbers are corrupt.
 * A chip reading "Unknown" with no reason is what sends the welcome desk to the
 * Stripe dashboard, which is the workflow this exists to end.
 *
 * `null` on every verdict that is NOT `unknown` - the field only ever explains
 * an absence of opinion, never a real one.
 */
export type RosterPaymentUnknownReason =
  | 'no-active-enrollment'
  | 'unpriceable-enrollment'
  | 'off-portal-program'
  | 'corrupt-total';

export interface RosterPaymentExplained {
  verdict: RosterPayment;
  /**
   * What the family owes across their active enrollments, or `null` when that
   * genuinely cannot be determined.
   *
   * `null` rather than 0 for the unknowable cases, deliberately. Printing
   * "$0 expected" next to "Unknown" states a fact we do not have, and a
   * volunteer reading it would tell a family they owe nothing. The one
   * `unknown` that DOES carry a total is `off-portal-program`, where the price
   * is known to be zero and it is the collection route we cannot see.
   */
  expectedCAD: number | null;
  unknownReason: RosterPaymentUnknownReason | null;
}

/**
 * The welcome-desk payment verdict for one family, WITH the arithmetic behind
 * it.
 *
 *  - `paid`           money was owed and it arrived
 *  - `outstanding`    money is owed and has not arrived
 *  - `not-applicable` no fee applies (a free program, or a waiver)
 *  - `unknown`        we cannot tell - see `unknownReason` for which of the four
 *
 * `paid` is reserved for money that actually arrived, so a family who owed
 * nothing is never labelled paid however much they happened to donate.
 *
 * `classifyRosterPayment` delegates to this and keeps its own signature, so the
 * existing callers are untouched and - more importantly - the explanation
 * can never drift from the verdict it explains. Computing the reason in a
 * second function beside the classifier would have been two implementations of
 * one rule, which is the failure mode this repo has already been bitten by
 * (a screen and its guard disagreeing).
 */
export function explainRosterPayment(
  active: readonly ActiveEnrollmentCharge[],
  paidCAD: number,
): RosterPaymentExplained {
  if (active.length === 0) {
    return { verdict: 'unknown', expectedCAD: null, unknownReason: 'no-active-enrollment' };
  }

  const amounts = active.map(chargeAmount);
  // A single unpriceable enrollment makes the whole family's balance
  // unknowable. Summing around it would report a verdict off the enrollments we
  // happen to understand while a program we know nothing about sits beside them.
  if (amounts.some((a) => a === null)) {
    return { verdict: 'unknown', expectedCAD: null, unknownReason: 'unpriceable-enrollment' };
  }

  const expected = amounts.reduce((sum: number, a) => sum + (a ?? 0), 0);

  // Garbage must never come out the "nothing is owed" door. Neither is
  // reachable through a validated write, but `rawToEnrollment` casts Firestore
  // data without parsing it, so a corrupt doc can get this far.
  if (!Number.isFinite(expected) || expected < 0) {
    return { verdict: 'unknown', expectedCAD: null, unknownReason: 'corrupt-total' };
  }

  if (expected > 0) {
    return {
      verdict: paidCAD >= expected ? 'paid' : 'outstanding',
      expectedCAD: expected,
      unknownReason: null,
    };
  }

  // expected === 0. "No fee applies" is only honest when the PORTAL is the one
  // that would have collected, because the portal's donations are all this
  // function can see. Both other sources settle up somewhere we are not looking:
  // 'teacher-managed' is cash collected by the teacher, and 'legacy' is the prod
  // RTDB roster's own payment field. A zero from either means "no opinion", not
  // "settled" - the one case where N/A would tell a volunteer a family is square
  // when it is not.
  //
  // Tested against `!== 'portal'` rather than the two names on purpose: a fourth
  // payment source added to PAYMENT_SOURCES later inherits the cautious verdict
  // instead of silently defaulting to "nothing is owed".
  //
  // This check stays FIRST, ahead of the settlement one below. A settled Bala
  // Vihar sitting next to a teacher-managed program still leaves cash we cannot
  // see, and "Paid" would tell a volunteer the family is square when it may not
  // be. Settlement answers for its own enrollment, never for the one beside it.
  const anyOffPortal = active.some((c) => sourceOf(c.offering) !== 'portal');
  if (anyOffPortal) {
    // `expectedCAD: 0` and not null, unlike the other three unknowns. The price
    // IS known here - it is zero - and what we cannot see is the COLLECTION
    // route. Saying so lets the desk tell a family "there is no portal fee, ask
    // your teacher" instead of "we don't know", which is a different and more
    // useful sentence.
    return { verdict: 'unknown', expectedCAD: 0, unknownReason: 'off-portal-program' };
  }

  // An admin has recorded that this family's donation arrives outside the
  // portal. That is a PAYMENT we simply cannot see, not the absence of one, so
  // it reads as `paid` - the same word the family's own dashboard uses. Without
  // this the settlement was indistinguishable from the Adult Study Class
  // waiver, and the welcome desk was told "N/A" about a family who pays every
  // month. See `settledOffPortal` on EnrollmentDocSchema for the whole story.
  return {
    verdict: active.some((c) => c.settledOffPortal) ? 'paid' : 'not-applicable',
    expectedCAD: 0,
    unknownReason: null,
  };
}

/**
 * The verdict alone, for the callers that only need the word.
 *
 * It is a projection of `explainRosterPayment`, never a second implementation -
 * that is what stops a screen and the guard that blocks its action from
 * drifting apart.
 *
 * ── Who actually calls this, checked rather than remembered ─────────────────
 * ONE direct caller: `classifyBulkPayment` in the portal's roster/payment.ts,
 * which the three bulk surfaces use (report-dataset, build-csv-rows,
 * teacher/attendance-detail). Everything single-family goes through
 * `deriveFamilyPayment` → `loadFamilyPaymentData` → `explainRosterPayment` and
 * never touches this signature.
 *
 * An earlier version of this comment listed "five call sites" including the
 * teacher roster confirmation, the enrollment report and the override route's
 * money guard. None of those three call it. Corrected 2026-08-06 after review;
 * the number was written from memory of which SCREENS show a payment verdict,
 * not from grepping which code calls this function.
 */
export function classifyRosterPayment(
  active: readonly ActiveEnrollmentCharge[],
  paidCAD: number,
): RosterPayment {
  return explainRosterPayment(active, paidCAD).verdict;
}
