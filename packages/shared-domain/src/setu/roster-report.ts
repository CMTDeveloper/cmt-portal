import { z } from 'zod';
import { ROSTER_PAYMENTS } from './roster';
import { GRADE_LADDER } from './grade-ladder';
import { normalizeGrade } from './schemas/level';

// One Bala Vihar-enrolled child, reduced to what the report filters + counts on.
export const RosterReportChildSchema = z.object({
  grade: z.string().nullable(),     // schoolGrade ("2","JK") or null
  levelName: z.string().nullable(), // BV enrollment level ("Level 2") or null
});
export type RosterReportChild = z.infer<typeof RosterReportChildSchema>;

// One family row - the lean payload the browser filters + renders.
export const RosterReportRowSchema = z.object({
  fid: z.string(),
  publicFid: z.string().nullable(),
  legacyFid: z.string().nullable(),
  name: z.string(),           // stored family name (legacy-derived; kept for search/fallback)
  parentName: z.string(),     // parents' display name for the card title (see formatFamilyParentNames)
  location: z.string(),
  memberCount: z.number().int().nonnegative(),
  payment: z.enum(ROSTER_PAYMENTS),
  programs: z.array(z.string()),    // active program LABELS, for display chips
  programKeys: z.array(z.string()), // active program KEYS, for the Program filter
  bvChildren: z.array(RosterReportChildSchema),
});
export type RosterReportRow = z.infer<typeof RosterReportRowSchema>;

export const RosterReportResponseSchema = z.object({ rows: z.array(RosterReportRowSchema) });
export type RosterReportResponse = z.infer<typeof RosterReportResponseSchema>;

export interface RosterReportFilters {
  location?: string | null;
  program?: string | null;                                   // programKey
  level?: string | null;                                     // levelName (BV)
  grade?: string | null;                                     // schoolGrade
  payment?: (typeof ROSTER_PAYMENTS)[number] | null;
}

export interface RosterReportSummary {
  familyCount: number;
  childCount: number;
  byLevel: Array<{ levelName: string; childCount: number }>;
  byPayment: { paid: number; outstanding: number; unknown: number };
}

// Does a single BV child satisfy the active per-child filters (level, grade)?
// Both must hold on the SAME child (spec: "at least 1 BV child passing every active child filter").
function childPasses(c: RosterReportChild, f: RosterReportFilters): boolean {
  if (f.level && c.levelName !== f.level) return false;
  // Grade is compared normalized so a legacy "Grade 4" child matches a "4" filter.
  if (f.grade && (c.grade == null || normalizeGrade(c.grade) !== normalizeGrade(f.grade))) return false;
  return true;
}

export function matchesRosterFilters(row: RosterReportRow, f: RosterReportFilters): boolean {
  if (f.location && row.location !== f.location) return false;
  if (f.program && !row.programKeys.includes(f.program)) return false;
  if (f.payment && row.payment !== f.payment) return false;
  if (f.level || f.grade) {
    if (!row.bvChildren.some((c) => childPasses(c, f))) return false;
  }
  return true;
}

const NO_LEVEL = '(no level)';

export function summarizeRoster(rows: RosterReportRow[], f: RosterReportFilters): RosterReportSummary {
  const included = rows.filter((r) => matchesRosterFilters(r, f));
  const byLevelMap = new Map<string, number>();
  const byPayment = { paid: 0, outstanding: 0, unknown: 0 };
  let childCount = 0;
  for (const r of included) {
    byPayment[r.payment]++;
    for (const c of r.bvChildren) {
      if (!childPasses(c, f)) continue;
      childCount++;
      const key = c.levelName ?? NO_LEVEL;
      byLevelMap.set(key, (byLevelMap.get(key) ?? 0) + 1);
    }
  }
  const byLevel = [...byLevelMap.entries()]
    .map(([levelName, count]) => ({ levelName, childCount: count }))
    .sort((a, b) => compareLevel(a.levelName, b.levelName));
  return { familyCount: included.length, childCount, byLevel, byPayment };
}

// "Level 2" < "Level 10" (numeric); non-numeric names sort last alphabetically.
function levelNum(name: string): number {
  const m = /(\d+)/.exec(name);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}
function compareLevel(a: string, b: string): number {
  const na = levelNum(a);
  const nb = levelNum(b);
  return na !== nb ? na - nb : a.localeCompare(b);
}

export function deriveLevelOptions(rows: RosterReportRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const c of r.bvChildren) if (c.levelName) set.add(c.levelName);
  return [...set].sort(compareLevel);
}

// Grade filter options are the canonical ladder rungs (JK, SK, 1..12) that are
// actually present, ladder-ordered. Raw child grades are normalized before the
// match, so "Grade 4" collapses onto "4" and legacy junk that maps to no rung
// ("Pre L1 (Gr JK-SK)", a stray "J") never surfaces as a filter chip.
export function deriveGradeOptions(rows: RosterReportRow[]): string[] {
  const present = new Set<string>();
  for (const r of rows) for (const c of r.bvChildren) if (c.grade) present.add(normalizeGrade(c.grade));
  return GRADE_LADDER.filter((rung) => present.has(normalizeGrade(rung)));
}
