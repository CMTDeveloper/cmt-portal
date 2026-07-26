import type { MemberDoc } from '@cmt/shared-domain/setu';
import { paymentSourceOf } from '@cmt/shared-domain';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import { selectBalaViharEnrollment } from '@/app/family/_helpers/select-bv-enrollment';
import { selectableAdults } from './selectable-adults';

/** Only the donation fields this predicate reads. */
export interface GateDonation {
  status: string;
  eid: string | null;
  amountCAD: number;
}

export interface AdultClassGateInput {
  /** Condition 1. Manager-scoped, like the family-address gate beside it. */
  isManager: boolean;
  members: readonly MemberDoc[];
  /** As returned by `getEnrollments` - carries `offering` + `effectiveSuggestedAmount`. */
  enrollments: EnrollmentWithOffering[];
  donations: readonly GateDonation[];
  /**
   * Condition 0. THE current adult-study-class offering, or `null` when none is
   * reachable. Defined as `getOpenOfferingsForFamily(...)[0]` - that function
   * orders by `startDate` ascending in Firestore, so [0] is the earliest open
   * one, and the `/adult-class` screen must enroll into this same `oid`.
   */
  currentOffering: { oid: string } | null;
  teacherAssignedMids: ReadonlySet<string>;
  /** Meaningful ONLY when the BV offering is legacy-sourced. See below. */
  legacyPaymentStatus: string;
}

/**
 * Whether this family must be asked to choose an adult for the Adult Study Class.
 *
 * PURE. All I/O is the caller's job (`loadAdultClassGateData`), because this runs
 * behind a gate on every `/family/*` render and the inputs cost roughly seven
 * Firestore reads - including one `teacherAssignments` doc read PER adult.
 *
 * Conditions are spec 2.1, plus **condition 0**, which the spec's list omits.
 */
export function needsAdultClassSelection(input: AdultClassGateInput): boolean {
  // ── Condition 0: is there anything to enroll INTO? ────────────────────────
  // Not in the spec's list, and without it this feature can lock families out
  // of the portal entirely. `getOpenOfferingsForFamily` filters
  // `enabled == true` and drops expired offerings, so the day an admin closes
  // registration - the documented meaning of that toggle - or the launch
  // offering lapses, or one location is missed, there is no current offering.
  // Condition 4 would then have no oid to compare against, "no active
  // enrollment for the current term" would be trivially true, the gate would
  // fire, and every paid Bala Vihar manager at that location would be
  // redirected to a screen with nothing to enroll into and no way back to
  // /family. There is no escape hatch in the design without this check.
  if (!input.currentOffering) return false;

  // ── Condition 1: manager only ────────────────────────────────────────────
  if (!input.isManager) return false;

  // ── Condition 2: an active Bala Vihar enrollment ─────────────────────────
  // BY programKey, never "the first active enrollment": getEnrollments sorts
  // enrolledAt DESC, so a newer Tabla enrollment would otherwise hijack this.
  const bv = selectBalaViharEnrollment(input.enrollments);
  if (!bv) return false;

  // ── Condition 3: that Bala Vihar donation is PAID ────────────────────────
  // A three-way disjunction, and two of the three legs are easy to get wrong.
  //
  // (a) Donations, scoped to THIS enrollment's eid. `sumCompletedDonations(fid)`
  //     exists but is program-BLIND - it sums every completed donation for the
  //     family - so using it would let a Tabla or general gift satisfy the Bala
  //     Vihar amount and waive the fee for a family that never paid Bala Vihar.
  const expected = bv.effectiveSuggestedAmount ?? 0;
  const paidForBv = input.donations
    .filter((d) => d.status === 'completed' && d.eid != null && d.eid === bv.eid)
    .reduce((sum, d) => sum + (typeof d.amountCAD === 'number' ? d.amountCAD : 0), 0);
  const bvPaidByDonation = paidForBv >= expected;

  // (b) Legacy, GATED on the offering actually being legacy-sourced. Ungated, a
  //     family whose 2025-26 legacy row reads `paid` would be treated as having
  //     paid the 2026-27 donation - contradicting spec section 2 ("After the BV
  //     donation") and waiving a fee they never earned.
  // The conditional-spread call shape is the repo's established idiom for this
  // helper under `exactOptionalPropertyTypes` (see donate/page.tsx:63,
  // enroll/[programKey]/page.tsx:33, checkout/route.ts:137): passing the
  // offering directly fails because its `paymentSource` is `T | undefined`,
  // which is not assignable to an exact-optional `paymentSource?: T`.
  const source = paymentSourceOf(
    bv.offering?.paymentSource !== undefined ? { paymentSource: bv.offering.paymentSource } : {},
  );
  const bvPaidByLegacy = source === 'legacy' && input.legacyPaymentStatus === 'paid';

  // (c) Teacher-managed offerings are never paid in-portal, so a family on one
  //     would otherwise be gated forever.
  const bvPaid = bvPaidByDonation || bvPaidByLegacy || source === 'teacher-managed';
  if (!bvPaid) return false;

  // ── Condition 4: no active ASC enrollment FOR THE CURRENT TERM ────────────
  // Scoped to `currentOffering.oid`, not "any adult-class enrollment ever":
  // checking history would silently exempt every returning family after year
  // one (spec 4.6.1).
  //
  // "…carrying at least one adult" is deliberate. When the chosen adult later
  // leaves the family, the member-edit prune empties `enrolledMids`, and that
  // family still needs to choose someone - so an empty list must RE-FIRE the
  // gate rather than read as satisfied.
  const currentAsc = input.enrollments.find(
    (e) => e.status === 'active' && e.oid === input.currentOffering!.oid,
  );
  if (currentAsc && (currentAsc.enrolledMids?.length ?? 0) > 0) return false;

  // ── Condition 5: at least one adult is eligible to attend ────────────────
  // Resolves matrix rows 3, 4 and 7 through one mechanism - an empty set.
  return selectableAdults(input.members, input.teacherAssignedMids).length > 0;
}
