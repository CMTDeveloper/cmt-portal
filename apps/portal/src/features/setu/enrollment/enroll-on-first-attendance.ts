import { enrollFamily } from './enroll-family';
import type { EnrollFamilyResult } from './enroll-family';

export type FirstAttendanceEnrollParams = {
  fid: string;
  pid: string;
  markedByTeacherUid: string;
};

/**
 * Called by Slice 4 (attendance) when a teacher marks a child present and the
 * family has no active enrollment for the current period.
 *
 * Exported for Slice 4 to wire at the call site — do NOT call from any
 * existing Slice 3 route or UI flow.
 */
export async function enrollFamilyOnFirstAttendance(
  params: FirstAttendanceEnrollParams,
): Promise<EnrollFamilyResult> {
  return enrollFamily({
    fid: params.fid,
    pid: params.pid,
    enrolledVia: 'first-attendance',
    enrolledByMid: null,
  });
}
