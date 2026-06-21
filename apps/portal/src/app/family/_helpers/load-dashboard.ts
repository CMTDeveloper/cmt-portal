import type { FamilyDoc, MemberDoc, ProgramDoc } from '@cmt/shared-domain';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { getDonations } from '@/features/setu/donations/get-donations';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { getUpcoming, type CalendarEntry } from '@/features/setu/calendar/calendar';
import { listPrograms } from '@/features/setu/programs/get-programs';
import { getFamilySevaProgress, type FamilySevaProgress } from '@/features/setu/seva/get-family-seva-progress';
import { getFamilyAssignment, type FamilyPrasadView } from '@/features/setu/prasad/family-assignment';
import {
  buildFamilyDashboardModel,
  isLegacyBvPeriod,
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
 * the BV-bespoke model (enrollment/donation pinned to the active Bala Vihar
 * enrollment), the next class dates, seva progress, and the prasad assignment.
 * Shared by the /family server page AND GET /api/setu/dashboard so the web and
 * mobile dashboards never drift.
 *
 * Family-level attendance is intentionally NOT loaded here — attendance is a
 * child-at-program concept and lives on each child's profile, not on the family
 * home (the `_members` param is kept only for call-site/API stability).
 *
 * All reads that don't depend on each other run concurrently to keep the
 * /family navigation snappy. The only data dependency is `legacyPaymentStatus`,
 * which needs `enrollments` to decide whether the (RTDB) read is even worth
 * doing — so it's awaited in a second, narrow step, not serialized behind the
 * unrelated calendar/seva/prasad reads.
 */
export async function loadFamilyDashboard(
  family: FamilyDoc,
  _members: MemberDoc[],
): Promise<FamilyDashboardData> {
  // Everything below is independent of everything else — fan them all out at
  // once rather than in sequential Promise.all groups.
  const [enrollments, donations, allPrograms, { upcoming }, seva, prasad] = await Promise.all([
    getEnrollments(family.fid),
    getDonations(family.fid),
    listPrograms(),
    // Calendar is the Bala Vihar program's — scope to 'bala-vihar' so a second
    // usesCalendar program can't leak dates into the family home.
    getUpcoming(family.location, 'bala-vihar', undefined, 3),
    getFamilySevaProgress(family.fid),
    getFamilyAssignment(family.fid),
  ]);
  const programsById = new Map<string, ProgramDoc>(allPrograms.map((p) => [p.programKey, p]));

  // Legacy roster status only matters for the 2025-26 cutover BV offering;
  // skip the extra RTDB read otherwise (same predicate the model uses). This
  // depends on `enrollments`, so it can't join the fan-out above.
  const legacyPaymentStatus = isLegacyBvPeriod(enrollments)
    ? await getLegacyPaymentStatus(family.legacyFid)
    : null;

  const model = buildFamilyDashboardModel({
    enrollments,
    donations,
    programsById,
    legacyPaymentStatus,
  });

  return { model, upcoming, seva, prasad };
}
