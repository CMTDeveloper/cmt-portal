import { getAttendanceForFamily } from '@/features/setu/teacher/get-attendance';
import { getCheckInAttendance, summarizeMemberCheckIns } from './check-in-attendance';
import {
  resolveMemberAttendance,
  summarizeResolvedMarks,
  STATUS_RANK,
  type ResolvedMark,
  type ResolvedSummary,
} from './resolve-attendance';

export interface FamilyBvAttendanceArgs {
  fid: string;
  legacyFid: string | null;
  /** The BV enrollment's offering id (oid) — only portal events for it count. */
  oid: string;
  /** Door-side window (YMD) from the BV offering; null = unbounded that side. */
  windowStart: string | null;
  windowEnd: string | null;
  /** The BV-enrolled children (mid + legacySid for the door link). */
  children: ReadonlyArray<{ mid: string; legacySid: string | null }>;
}

/**
 * Family-level BV attendance = the UNION of teacher `attendanceEvents` and door
 * self-check-ins, answering "did ANY enrolled child attend that Sunday?". Each
 * child is resolved INDEPENDENTLY (portal wins per child) and then folded by
 * date taking the best status across children — so one child's teacher-absent
 * can never erase a sibling's door-present (the N=2 trap). Door records are
 * window-scoped (door has no offering link); portal events are oid-filtered.
 */
export async function getFamilyBalaViharAttendance(args: FamilyBvAttendanceArgs): Promise<ResolvedSummary> {
  const [familyEvents, doorRecords] = await Promise.all([
    getAttendanceForFamily(args.fid),
    getCheckInAttendance(args.legacyFid),
  ]);

  const start = args.windowStart ?? '0000-01-01';
  const end = args.windowEnd ?? '9999-12-31';
  const scopedDoor = doorRecords.filter((r) => r.date >= start && r.date <= end);

  const byDate = new Map<string, ResolvedMark>();
  for (const child of args.children) {
    const portalMarks = familyEvents
      .filter((e) => e.mid === child.mid && e.pid === args.oid)
      .map((e) => ({ date: e.date, status: e.status }));
    const doorMarks = summarizeMemberCheckIns(scopedDoor, child.legacySid).marks;
    const resolved = resolveMemberAttendance(portalMarks, doorMarks);
    for (const m of resolved.marks) {
      const cur = byDate.get(m.date);
      // Best status across children wins; on a tie, prefer a portal mark so the
      // folded `source` reflects an authoritative teacher mark over a door one.
      const better =
        !cur ||
        STATUS_RANK[m.status] > STATUS_RANK[cur.status] ||
        (STATUS_RANK[m.status] === STATUS_RANK[cur.status] && m.source === 'portal' && cur.source === 'door');
      if (better) byDate.set(m.date, m);
    }
  }

  return summarizeResolvedMarks([...byDate.values()]);
}
