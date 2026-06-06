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

// When a member has more than one portal mark on the same date (e.g. enrolled
// in two levels under one program), the attended status wins deterministically
// — present > late > absent — so a stray absent can never silently overwrite an
// attendance. (Guards the N=2 / one→many trap; door marks are unique per date.)
export const STATUS_RANK: Record<SetuAttendanceStatus, number> = { present: 2, late: 1, absent: 0 };

/** Build a ResolvedSummary from already-merged marks (any order). */
export function summarizeResolvedMarks(marks: ReadonlyArray<ResolvedMark>): ResolvedSummary {
  const sorted = [...marks].sort((a, b) => a.date.localeCompare(b.date));
  const present = sorted.filter((m) => m.status === 'present').length;
  const late = sorted.filter((m) => m.status === 'late').length;
  const absent = sorted.filter((m) => m.status === 'absent').length;
  const total = sorted.length;
  const attendedPct = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
  return { present, late, absent, total, attendedPct, marks: sorted };
}

/** A zero-attendance summary (no BV enrollment / no data). */
export const EMPTY_RESOLVED_SUMMARY: ResolvedSummary = {
  present: 0, late: 0, absent: 0, total: 0, attendedPct: 0, marks: [],
};

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
  // Portal overrides door. Among multiple same-date portal marks, the
  // higher-ranked (more-attended) status wins — never insertion order.
  for (const p of portalMarks) {
    const existing = byDate.get(p.date);
    const portalWins =
      !existing ||
      existing.source === 'door' ||
      STATUS_RANK[p.status] > STATUS_RANK[existing.status];
    if (portalWins) {
      byDate.set(p.date, { date: p.date, status: p.status, source: 'portal' });
    }
  }

  return summarizeResolvedMarks([...byDate.values()]);
}
