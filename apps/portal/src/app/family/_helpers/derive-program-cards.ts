import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import type { ProgramDoc } from '@cmt/shared-domain';

export interface ProgramCard {
  /** Enrollment ID for linking (donate URL, etc.) */
  eid: string;
  programKey: string;
  label: string;
  termLabel: string;
  status: 'active' | 'cancelled';
  /** True when the program's attendanceMode !== 'none'. */
  showAttendance: boolean;
  /** True when the program's capabilities.usesDonation is true. */
  showDonation: boolean;
}

/**
 * Pure helper: derives one display card per active enrollment.
 * Capabilities are read from the program doc (by programKey). When the program
 * doc is absent (stale enrollment), falls back to safe/false values.
 *
 * Only `status === 'active'` enrollments are included.
 */
export function deriveProgramCards(
  enrollments: EnrollmentWithOffering[],
  programsById: Map<string, ProgramDoc>,
): ProgramCard[] {
  return enrollments
    .filter((e) => e.status === 'active')
    .map((e) => {
      const program = programsById.get(e.programKey);
      const showAttendance =
        program != null && program.capabilities.attendanceMode !== 'none';
      const showDonation = program?.capabilities.usesDonation ?? false;

      return {
        eid: e.eid,
        programKey: e.programKey,
        label: e.programLabel,
        termLabel: e.termLabel,
        status: e.status,
        showAttendance,
        showDonation,
      };
    });
}
