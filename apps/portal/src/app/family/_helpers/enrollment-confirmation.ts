import type { DonationDoc } from '@cmt/shared-domain';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';

export interface ConfirmationInputs {
  /** present+late attendance marks inside the enrollment's offering window. */
  attendedCount: number;
  /** ALL of the family's donations (any program — filtered by eid here). */
  donations: DonationDoc[];
  /** Legacy-sourced BV offering already paid in the legacy roster. */
  legacyPaid: boolean;
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
  return inputs.donations.some((d) => d.status === 'completed' && d.eid === enrollment.eid);
}
