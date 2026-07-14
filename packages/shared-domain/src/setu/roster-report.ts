import { z } from 'zod';
import { ROSTER_PAYMENTS } from './roster';

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
  if (f.grade && c.grade !== f.grade) return false;
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

// K-family grades first (K, JK, SK, PK), then numeric ascending, then any other string.
const GRADE_RANK: Record<string, number> = { K: 0, JK: 1, SK: 2, PK: 3 };
function gradeSortKey(g: string): [number, number, string] {
  const up = g.toUpperCase();
  if (up in GRADE_RANK) return [0, GRADE_RANK[up]!, up];
  const n = Number(g);
  if (Number.isFinite(n)) return [1, n, g];
  return [2, 0, up];
}
export function deriveGradeOptions(rows: RosterReportRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const c of r.bvChildren) if (c.grade) set.add(c.grade);
  return [...set].sort((a, b) => {
    const ka = gradeSortKey(a);
    const kb = gradeSortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
}
