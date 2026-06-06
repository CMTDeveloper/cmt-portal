import { getAttendanceForMember } from '@/features/setu/teacher/get-attendance';
import { getCheckInAttendance, summarizeMemberCheckIns } from './check-in-attendance';
import { resolveMemberAttendance, type ResolvedSummary } from './resolve-attendance';

export interface MemberUnifiedAttendanceArgs {
  mid: string;
  legacyFid: string | null;
  legacySid: string | null;
  /** When set, only portal events for this offering id (oid) are counted. */
  pid?: string | null;
  /** Door-side window (YMD) from the offering; null/omitted = unbounded. */
  windowStart?: string | null;
  windowEnd?: string | null;
}

/**
 * One member's unified attendance = portal `attendanceEvents` (authoritative)
 * merged with the door app's `family-check-ins`. The composing reader the family
 * surfaces (child profile, dashboard) and teacher student view consume.
 */
export async function getMemberUnifiedAttendance(
  args: MemberUnifiedAttendanceArgs,
): Promise<ResolvedSummary> {
  const [events, doorRecords] = await Promise.all([
    getAttendanceForMember(args.mid),
    getCheckInAttendance(args.legacyFid),
  ]);
  const portalMarks = events
    .filter((e) => (args.pid ? e.pid === args.pid : true))
    .map((e) => ({ date: e.date, status: e.status }));
  const start = args.windowStart ?? '0000-01-01';
  const end = args.windowEnd ?? '9999-12-31';
  const scopedDoor = doorRecords.filter((r) => r.date >= start && r.date <= end);
  const doorMarks = summarizeMemberCheckIns(scopedDoor, args.legacySid).marks;
  return resolveMemberAttendance(portalMarks, doorMarks);
}
