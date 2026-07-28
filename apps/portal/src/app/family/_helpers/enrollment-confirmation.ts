import type { DonationDoc } from '@cmt/shared-domain';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';

export interface ConfirmationInputs {
  /** present+late attendance marks inside the enrollment's offering window. */
  attendedCount: number;
  /** ALL of the family's donations (any program — filtered by eid here). */
  donations: DonationDoc[];
  /** Legacy-sourced BV offering already paid in the legacy roster. */
  legacyPaid: boolean;
  /**
   * The family has a LIVE monthly pledge - `isPledgeGiving(pledge)`, which is
   * `active` only. Never `started`: that means the family was sent to Stripe and
   * nothing came back, so no mandate and no money exist.
   *
   * REQUIRED, not optional-with-a-default, deliberately. Every caller of this
   * rule is a surface that tells someone whether a family has paid - the family
   * dashboard, the teacher roster, the welcome roster, the reports. An optional
   * field would let a new surface silently inherit "no pledge" and quietly
   * disagree with the others about the same family.
   */
  hasActivePledge: boolean;
}

/**
 * Issue #23 product rule (owner decision 2026-07-02): a family is CONFIRMED
 * ("Enrolled") for an enrollment only after real engagement — attended ≥1 class
 * in the enrollment's window, OR any completed donation tied to its eid, OR
 * (legacy cutover offerings) the legacy roster shows paid. Amount is irrelevant
 * (donations are suggestions, not fees). Per-year scoping is structural:
 * attendance is window-scoped by the caller and donations match on this
 * enrollment's eid.
 *
 * Slice 1 (2026-07-06): a DELIBERATE enrollment now confirms on its own —
 * 'family-initiated' (the family clicked Enroll) and 'first-attendance' (a child
 * showed up and a teacher auto-enrolled them) are affirmative intent signals, so
 * they read "Enrolled" immediately even with $0 given. Only 'promotion'
 * (rollover carry-forward) and 'welcome-team' (staff backfill) enrollments still
 * require the engagement triggers above to graduate from "Registered" →
 * "Enrolled" (issue #23's carry-you-forward state).
 */
export function isEnrollmentConfirmed(
  enrollment: Pick<EnrollmentWithOffering, 'eid' | 'enrolledVia'>,
  inputs: ConfirmationInputs,
): boolean {
  if (enrollment.enrolledVia === 'family-initiated') return true;
  if (enrollment.enrolledVia === 'first-attendance') return true;
  if (inputs.attendedCount > 0) return true;
  if (inputs.legacyPaid) return true;
  // ⚠️ PRECONDITION: `enrollment` must be a BALA VIHAR enrollment.
  //
  // The monthly pledge funds Bala Vihar specifically, but this rule is generic,
  // so passing a Tabla or Om-chanting enrollment here would let a Bala Vihar
  // pledge mark it confirmed - a family reading as paid for a programme they
  // have paid nothing toward. Audited 2026-07-27: all four callers are
  // BV-scoped, three of them structurally (`selectBalaViharEnrollment` in
  // dashboard-model + family-engagement, `programKey === BV_PROGRAM_KEY` in
  // enrollment-report) and one by convention (teacher levels are BV). If a
  // FIFTH caller appears, or a teacher screen ever covers a non-BV programme,
  // thread `programKey` in and gate this clause on it - do not rely on the
  // caller remembering. This project has already shipped one bug in this exact
  // family, which is why `selectBalaViharEnrollment` is lint-guarded.
  //
  // The monthly pledge IS the enrollment donation, paid a month at a time
  // (Vaibhav, 2026-07-27: "this is an enrollment option one-time vs monthly").
  // Family-level and unscoped by eid on purpose: the plan is continuous until
  // manually stopped, so a family who keeps paying keeps satisfying the CURRENT
  // year's enrollment across a rollover, without re-deciding every August.
  if (inputs.hasActivePledge) return true;
  return inputs.donations.some((d) => d.status === 'completed' && d.eid === enrollment.eid);
}
