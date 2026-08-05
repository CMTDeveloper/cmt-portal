import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { memberMatchesLevel, type LevelKind } from '@cmt/shared-domain';

export interface LevelForMatch {
  levelId: string;
  levelName: string;
  levelKind: LevelKind;
  gradeBand: string[];
}

/**
 * The first ENABLED level (in doc order) whose kind / grade-band matches the
 * child, or null. Pure — reuses the SAME `memberMatchesLevel` the teacher roster
 * uses (`features/setu/teacher/roster.ts`), so the family dashboard shows a child
 * in the exact level a teacher sees them in.
 *
 * This backs the dashboard's LIVE fallback: `enrollFamily` never writes
 * `levelSnapshots` (only the annual rollover does), so a self-enrolled child has
 * no snapshot — deriving from their current grade turns "Level pending" into the
 * real level instead of leaving it blank until rollover.
 */
export function matchChildLevel(
  member: { type: 'Adult' | 'Child'; schoolGrade: string | null; birthMonthYear: string | null },
  levels: LevelForMatch[],
  now: Date,
): { levelId: string; levelName: string } | null {
  const m = levels.find((l) => memberMatchesLevel(member, l, now));
  return m ? { levelId: m.levelId, levelName: m.levelName } : null;
}

/**
 * Enabled levels for a Bala Vihar offering (pid), shaped for `matchChildLevel`.
 * Single-field `where('pid')` → no composite index. Disabled levels are excluded
 * (a paused level must not place a child) so an unmatched child stays "pending".
 */
export async function fetchEnabledLevelsForPid(pid: string): Promise<LevelForMatch[]> {
  const snap = await portalFirestore().collection('levels').where('pid', '==', pid).get();
  return snap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((l) => l['enabled'] !== false)
    .map((l) => ({
      levelId: String(l['levelId']),
      levelName: String(l['levelName']),
      levelKind: l['levelKind'] as LevelKind,
      gradeBand: (l['gradeBand'] as string[]) ?? [],
    }))
    // Same order as `report-dataset.ts` builds, and for the same reason.
    // `matchChildLevel` takes the FIRST match, and bands are only disjoint by
    // convention - nothing enforces it, and `memberMatchesLevel` normalizes
    // both sides, so "3" on one level and "Grade 3" on another would both
    // match. Ordering by name makes the winner the same here and on the
    // roster; without it the family dashboard and the welcome roster could
    // name DIFFERENT levels for one child, which is worse than either being
    // wrong. (No such overlap exists in production - audited 2026-08-05.)
    .sort((a, b) => a.levelName.localeCompare(b.levelName));
}
