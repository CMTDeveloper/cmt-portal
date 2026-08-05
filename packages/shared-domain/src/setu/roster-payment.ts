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
 * The welcome-desk payment verdict for one family.
 *
 *  - `paid`           money was owed and it arrived
 *  - `outstanding`    money is owed and has not arrived
 *  - `not-applicable` no fee applies (a free program, or a waiver)
 *  - `unknown`        we cannot tell
 *
 * `paid` is reserved for money that actually arrived, so a family who owed
 * nothing is never labelled paid however much they happened to donate.
 */
export function classifyRosterPayment(
  active: readonly ActiveEnrollmentCharge[],
  paidCAD: number,
): RosterPayment {
  if (active.length === 0) return 'unknown';

  const amounts = active.map(chargeAmount);
  // A single unpriceable enrollment makes the whole family's balance
  // unknowable. Summing around it would report a verdict off the enrollments we
  // happen to understand while a program we know nothing about sits beside them.
  if (amounts.some((a) => a === null)) return 'unknown';

  const expected = amounts.reduce((sum: number, a) => sum + (a ?? 0), 0);

  // Garbage must never come out the "nothing is owed" door. Neither is
  // reachable through a validated write, but `rawToEnrollment` casts Firestore
  // data without parsing it, so a corrupt doc can get this far.
  if (!Number.isFinite(expected) || expected < 0) return 'unknown';

  if (expected > 0) return paidCAD >= expected ? 'paid' : 'outstanding';

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
  if (anyOffPortal) return 'unknown';

  // An admin has recorded that this family's donation arrives outside the
  // portal. That is a PAYMENT we simply cannot see, not the absence of one, so
  // it reads as `paid` - the same word the family's own dashboard uses. Without
  // this the settlement was indistinguishable from the Adult Study Class
  // waiver, and the welcome desk was told "N/A" about a family who pays every
  // month. See `settledOffPortal` on EnrollmentDocSchema for the whole story.
  return active.some((c) => c.settledOffPortal) ? 'paid' : 'not-applicable';
}
