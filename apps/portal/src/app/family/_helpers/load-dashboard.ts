import type { FamilyDoc, MemberDoc, ProgramDoc } from '@cmt/shared-domain';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { getDonations } from '@/features/setu/donations/get-donations';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { getUpcoming, type CalendarEntry } from '@/features/setu/calendar/calendar';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';
import { listPrograms } from '@/features/setu/programs/get-programs';
import { getFamilySevaProgress, type FamilySevaProgress } from '@/features/setu/seva/get-family-seva-progress';
import { getFamilyAssignment, type FamilyPrasadView } from '@/features/setu/prasad/family-assignment';
import { getFamilyBalaViharAttendance } from '@/features/setu/attendance/get-family-attendance';
import { getPerChildBalaViharAttendance } from '@/features/setu/attendance/get-per-child-attendance';
import { getBvTeacherNames } from '@/features/setu/attendance/get-bv-teacher-names';
import { isoToTorontoDateInput } from '@/lib/toronto-date';
import {
  buildFamilyDashboardModel,
  isLegacyBvPeriod,
  type FamilyDashboardModel,
} from './dashboard-model';
import { selectBalaViharEnrollment } from './select-bv-enrollment';

export interface BvChildView {
  mid: string;
  firstName: string;
  levelName: string | null;
  teacherNames: string[];
  attendance: { present: number; total: number };
}

export interface FamilyDashboardData {
  model: FamilyDashboardModel;
  upcoming: CalendarEntry[];
  seva: FamilySevaProgress;
  prasad: FamilyPrasadView | null;
  bvChildren: BvChildView[];
  familyCounts: { children: number; adults: number };
}

/**
 * Loads + composes everything the family dashboard derives from a real family:
 * the BV-bespoke model (enrollment/donation pinned to the active Bala Vihar
 * enrollment), the next class dates, seva progress, and the prasad assignment.
 * Shared by the /family server page AND GET /api/setu/dashboard so the web and
 * mobile dashboards never drift.
 *
 * Family-level attendance is loaded here only as a COUNT — the number of
 * Sundays a BV-enrolled child attended inside the active offering's window —
 * which the model needs to derive `bvState` (issue #23: "Enrolled" means
 * engaged, not merely registered). The per-date attendance heatmap is still a
 * child-at-program concept and lives on each child's profile, not the family
 * home; that's why `members` is needed (to map enrolled mids → legacy sids).
 *
 * All reads that don't depend on each other run concurrently to keep the
 * /family navigation snappy. The two reads that need `enrollments` first —
 * `legacyPaymentStatus` (only for the 2025-26 cutover offering) and the BV
 * attended-count (only when an active BV enrollment exists) — run together in a
 * single second `Promise.all`, not serialized behind each other or behind the
 * unrelated calendar/seva/prasad reads.
 */
export async function loadFamilyDashboard(
  family: FamilyDoc,
  members: MemberDoc[],
): Promise<FamilyDashboardData> {
  // The live school year scopes the calendar read so cloned next-year Sundays
  // stay hidden until Activate; it's a cached read so resolving it before the
  // fan-out adds no meaningful latency.
  const liveYear = await getLiveSchoolYearCached();

  // Everything below is independent of everything else — fan them all out at
  // once rather than in sequential Promise.all groups.
  const [enrollments, donations, allPrograms, { upcoming }, seva, prasad] = await Promise.all([
    getEnrollments(family.fid),
    getDonations(family.fid),
    listPrograms(),
    // Calendar is the Bala Vihar program's — scope to 'bala-vihar' so a second
    // usesCalendar program can't leak dates into the family home, and to the live
    // school year so next-year (preparing) Sundays stay hidden until Activate.
    getUpcoming(family.location, 'bala-vihar', liveYear, undefined, 3),
    getFamilySevaProgress(family.fid),
    getFamilyAssignment(family.fid),
  ]);
  const programsById = new Map<string, ProgramDoc>(allPrograms.map((p) => [p.programKey, p]));

  // Cheap header counts derived from the already-loaded members — no extra read.
  const familyCounts = {
    children: members.filter((m) => m.type === 'Child').length,
    adults: members.filter((m) => m.type === 'Adult').length,
  };

  // Both of these need `enrollments` (so they can't join the fan-out above),
  // but they're independent of EACH OTHER — run them concurrently in one narrow
  // second step rather than serializing.
  const bv = selectBalaViharEnrollment(enrollments);
  const [legacyPaymentStatus, bvAttendedCount, perChildAttendance, teacherNamesByLevel] =
    await Promise.all([
      // Legacy roster status only matters for the 2025-26 cutover BV offering;
      // skip the extra RTDB read otherwise (same predicate the model uses).
      isLegacyBvPeriod(enrollments)
        ? getLegacyPaymentStatus(family.legacyFid)
        : Promise.resolve(null),
      // Issue #23: "Enrolled" now means engaged. Count attended Sundays inside the
      // active BV enrollment's window so the model can derive bvState. One extra
      // narrow read, only when an active BV enrollment exists.
      (async (): Promise<number> => {
        if (!bv) return 0;
        try {
          const byMid = new Map(members.map((m): [string, MemberDoc] => [m.mid, m]));
          const children = bv.enrolledMids.map((mid) => ({
            mid,
            legacySid: byMid.get(mid)?.legacySid ?? null,
          }));
          // Offering boundaries store Toronto-aware timestamps (endDate is 23:59:59
          // America/Toronto, i.e. early-morning UTC the *next* day). Derive the
          // window YMDs in the Toronto calendar so they match the door check-in
          // records — a UTC `.slice(0,10)` would push end-of-day one day late.
          const summary = await getFamilyBalaViharAttendance({
            fid: family.fid,
            legacyFid: family.legacyFid,
            oid: bv.oid,
            windowStart: bv.offering
              ? isoToTorontoDateInput(bv.offering.startDate.toISOString())
              : null,
            windowEnd: bv.offering?.endDate
              ? isoToTorontoDateInput(bv.offering.endDate.toISOString())
              : null,
            children,
          });
          return summary.present + summary.late;
        } catch (err) {
          // Issue #23 (I1): this read is purely cosmetic — it only decides whether
          // the BV pill reads "Enrolled" vs "Registered". A transient Firestore
          // error (or a `(fid,date)` index not deployed in some environment) must
          // NOT 500 the entire family home + GET /api/setu/dashboard over a pill,
          // so degrade to 0 (⇒ Registered), mirroring the guarded roster read in
          // features/setu/roster/family-engagement.ts.
          console.warn(
            '[load-dashboard] BV attendance read failed — treating attended-count as 0',
            err,
          );
          return 0;
        }
      })(),
      // Per-child attendance ratios for the BV section. Fail-soft to an empty map.
      (async (): Promise<Map<string, { present: number; total: number }>> => {
        if (!bv) return new Map();
        try {
          const byMid = new Map(members.map((m): [string, MemberDoc] => [m.mid, m]));
          const children = bv.enrolledMids.map((mid) => ({
            mid,
            legacySid: byMid.get(mid)?.legacySid ?? null,
          }));
          return await getPerChildBalaViharAttendance({
            fid: family.fid,
            legacyFid: family.legacyFid,
            oid: bv.oid,
            windowStart: bv.offering
              ? isoToTorontoDateInput(bv.offering.startDate.toISOString())
              : null,
            windowEnd: bv.offering?.endDate
              ? isoToTorontoDateInput(bv.offering.endDate.toISOString())
              : null,
            children,
          });
        } catch (err) {
          console.warn(
            '[load-dashboard] per-child BV attendance read failed — treating as empty',
            err,
          );
          return new Map();
        }
      })(),
      // Teacher names per BV level (Task 4). Fail-soft to an empty map ⇒ the UI
      // shows level name with no teacher line. Reads only the levels this
      // family's enrolled children are actually in.
      (async (): Promise<Map<string, string[]>> => {
        if (!bv) return new Map();
        try {
          const levelIds = bv.enrolledMids
            .map((mid) => bv.levelSnapshots?.[mid]?.levelId ?? null)
            .filter((id): id is string => !!id);
          return await getBvTeacherNames(levelIds);
        } catch (err) {
          console.warn(
            '[load-dashboard] BV teacher-name read failed — omitting teacher names',
            err,
          );
          return new Map();
        }
      })(),
    ]);

  const model = buildFamilyDashboardModel({
    enrollments,
    donations,
    programsById,
    legacyPaymentStatus,
    bvAttendedCount,
  });

  // One view row per BV-enrolled child: joins the member's first name + the
  // enrollment's level snapshot + the teacher-name and per-child attendance maps
  // resolved above. Empty when there's no active BV enrollment.
  const byMidMember = new Map(members.map((m): [string, MemberDoc] => [m.mid, m]));
  const bvChildren: BvChildView[] = bv
    ? bv.enrolledMids.map((mid) => {
        const snap = bv.levelSnapshots?.[mid] ?? null;
        return {
          mid,
          firstName: byMidMember.get(mid)?.firstName ?? '',
          levelName: snap?.levelName ?? null,
          teacherNames: snap?.levelId ? (teacherNamesByLevel.get(snap.levelId) ?? []) : [],
          attendance: perChildAttendance.get(mid) ?? { present: 0, total: 0 },
        };
      })
    : [];

  return { model, upcoming, seva, prasad, bvChildren, familyCounts };
}
