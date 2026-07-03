import { getAttendanceForFamily } from '@/features/setu/teacher/get-attendance';
import { getCheckInAttendance, summarizeMemberCheckIns } from './check-in-attendance';
import { resolveMemberAttendance, summarizeResolvedMarks } from './resolve-attendance';
import type { FamilyBvAttendanceArgs } from './get-family-attendance';

/**
 * Per-child Bala Vihar attendance ratios for the family dashboard's BV section.
 *
 * Unlike `getFamilyBalaViharAttendance` (which folds every child into ONE family
 * summary answering "did ANY child attend that Sunday?"), this resolves each
 * child INDEPENDENTLY — a sibling's absence never touches another child's ratio —
 * and returns `{ present, total }` per mid, so the UI can render "Aarav 4/5".
 * `present` counts present+late (same "attended" semantics as the family count).
 * Door records are window-scoped (door has no offering link); portal teacher
 * marks are oid-filtered. A child with no in-window marks maps to `{0,0}`.
 */
export async function getPerChildBalaViharAttendance(
  args: FamilyBvAttendanceArgs,
): Promise<Map<string, { present: number; total: number }>> {
  const [familyEvents, doorRecords] = await Promise.all([
    getAttendanceForFamily(args.fid),
    getCheckInAttendance(args.legacyFid),
  ]);

  const start = args.windowStart ?? '0000-01-01';
  const end = args.windowEnd ?? '9999-12-31';
  const scopedDoor = doorRecords.filter((r) => r.date >= start && r.date <= end);

  const out = new Map<string, { present: number; total: number }>();
  for (const child of args.children) {
    const portalMarks = familyEvents
      .filter((e) => e.mid === child.mid && e.pid === args.oid)
      .map((e) => ({ date: e.date, status: e.status }));
    const doorMarks = summarizeMemberCheckIns(scopedDoor, child.legacySid).marks;
    const resolved = resolveMemberAttendance(portalMarks, doorMarks);
    const summary = summarizeResolvedMarks(resolved.marks);
    out.set(child.mid, { present: summary.present + summary.late, total: summary.total });
  }
  return out;
}
