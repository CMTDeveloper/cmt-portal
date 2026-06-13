import type { FamilyDoc, MemberDoc, ProgramDoc } from '@cmt/shared-domain';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { getDonations } from '@/features/setu/donations/get-donations';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { getUpcoming, getClassDatesHeld, type CalendarEntry } from '@/features/setu/calendar/calendar';
import { getFamilyBalaViharAttendance } from '@/features/setu/attendance/get-family-attendance';
import { EMPTY_RESOLVED_SUMMARY } from '@/features/setu/attendance/resolve-attendance';
import { listPrograms } from '@/features/setu/programs/get-programs';
import { getFamilySevaProgress, type FamilySevaProgress } from '@/features/setu/seva/get-family-seva-progress';
import { getFamilyAssignment, type FamilyPrasadView } from '@/features/setu/prasad/family-assignment';
import { selectBalaViharEnrollment } from './select-bv-enrollment';
import {
  buildFamilyDashboardModel,
  isLegacyBvPeriod,
  torontoYmd,
  type FamilyDashboardModel,
} from './dashboard-model';

export interface FamilyDashboardData {
  model: FamilyDashboardModel;
  upcoming: CalendarEntry[];
  seva: FamilySevaProgress;
  prasad: FamilyPrasadView | null;
}

/**
 * Loads + composes everything the family dashboard derives from a real family:
 * the BV-bespoke model (enrollment/donation/attendance pinned to the active
 * Bala Vihar enrollment), the next class dates, seva progress, and the prasad
 * assignment. Shared by the /family server page AND GET /api/setu/dashboard so
 * the web and mobile dashboards never drift — in particular the attendance
 * window-scoping (the N=2 trap) lives here once.
 */
export async function loadFamilyDashboard(
  family: FamilyDoc,
  members: MemberDoc[],
): Promise<FamilyDashboardData> {
  const [enrollments, donations, allPrograms] = await Promise.all([
    getEnrollments(family.fid),
    getDonations(family.fid),
    listPrograms(),
  ]);
  const programsById = new Map<string, ProgramDoc>(allPrograms.map((p) => [p.programKey, p]));

  // Legacy roster status only matters for the 2025-26 cutover BV offering;
  // skip the extra RTDB read otherwise (same predicate the model uses).
  const legacyPaymentStatus = isLegacyBvPeriod(enrollments)
    ? await getLegacyPaymentStatus(family.legacyFid)
    : null;

  // Calendar + attendance are the Bala Vihar program's — scope to 'bala-vihar'
  // so a second usesCalendar program can't leak dates in or inflate the count.
  const [{ upcoming }, classSundays] = await Promise.all([
    getUpcoming(family.location, 'bala-vihar', undefined, 3),
    getClassDatesHeld(family.location, 'bala-vihar'),
  ]);

  // Family-level BV attendance = teacher marks ∪ door check-ins, resolved per
  // child then folded by date, pinned to the active Bala Vihar enrollment.
  const bvEnrollment = selectBalaViharEnrollment(enrollments);
  let bvAttendance = EMPTY_RESOLVED_SUMMARY;
  if (bvEnrollment) {
    const off = bvEnrollment.offering;
    const children = bvEnrollment.enrolledMids
      .map((cmid) => members.find((mm) => mm.mid === cmid))
      .filter((mm): mm is NonNullable<typeof mm> => Boolean(mm))
      .map((mm) => ({ mid: mm.mid, legacySid: mm.legacySid ?? null }));
    bvAttendance = await getFamilyBalaViharAttendance({
      fid: family.fid,
      legacyFid: family.legacyFid,
      oid: bvEnrollment.oid,
      windowStart: off ? torontoYmd(off.startDate) : null,
      windowEnd: off?.endDate ? torontoYmd(off.endDate) : null,
      children,
    });
  }

  const model = buildFamilyDashboardModel({
    enrollments,
    donations,
    programsById,
    bvAttendance,
    classSundaysHeld: classSundays.length,
    legacyPaymentStatus,
  });

  const [seva, prasad] = await Promise.all([
    getFamilySevaProgress(family.fid),
    getFamilyAssignment(family.fid),
  ]);

  return { model, upcoming, seva, prasad };
}
