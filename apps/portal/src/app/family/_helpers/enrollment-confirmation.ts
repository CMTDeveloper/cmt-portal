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
 * (legacy cutover offerings) the legacy roster shows paid. Applies to every
 * enrolledVia; amount is irrelevant (donations are suggestions, not fees).
 * Per-year scoping is structural: attendance is window-scoped by the caller and
 * donations match on this enrollment's eid.
 */
export function isEnrollmentConfirmed(
  enrollment: Pick<EnrollmentWithOffering, 'eid'>,
  inputs: ConfirmationInputs,
): boolean {
  if (inputs.attendedCount > 0) return true;
  if (inputs.legacyPaid) return true;
  return inputs.donations.some((d) => d.status === 'completed' && d.eid === enrollment.eid);
}
