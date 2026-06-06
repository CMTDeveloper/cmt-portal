import type { SetuAttendanceStatus } from '@cmt/shared-domain';

export type ResolvedSource = 'portal' | 'door';

export interface ResolvedMark {
  date: string; // YYYY-MM-DD
  status: SetuAttendanceStatus; // present | late | absent
  source: ResolvedSource;
}

export interface ResolvedSummary {
  present: number;
  late: number;
  absent: number;
  total: number;
  attendedPct: number; // (present + late) / total, rounded
  marks: ResolvedMark[]; // ascending by date
}

/**
 * Merge a member's portal attendance marks (authoritative) with their door
 * check-ins into one timeline. Per date: a portal mark wins; otherwise a door
 * check-in maps to 'present' and a door recorded-but-not-checked-in maps to
 * 'absent'. Portal marks are richer (present/late/absent); door is binary.
 */
export function resolveMemberAttendance(
  portalMarks: ReadonlyArray<{ date: string; status: SetuAttendanceStatus }>,
  doorMarks: ReadonlyArray<{ date: string; present: boolean }>,
): ResolvedSummary {
  const byDate = new Map<string, ResolvedMark>();

  // Door first (lower precedence).
  for (const d of doorMarks) {
    byDate.set(d.date, { date: d.date, status: d.present ? 'present' : 'absent', source: 'door' });
  }
  // Portal overrides.
  for (const p of portalMarks) {
    byDate.set(p.date, { date: p.date, status: p.status, source: 'portal' });
  }

  const marks = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const present = marks.filter((m) => m.status === 'present').length;
  const late = marks.filter((m) => m.status === 'late').length;
  const absent = marks.filter((m) => m.status === 'absent').length;
  const total = marks.length;
  const attendedPct = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
  return { present, late, absent, total, attendedPct, marks };
}
