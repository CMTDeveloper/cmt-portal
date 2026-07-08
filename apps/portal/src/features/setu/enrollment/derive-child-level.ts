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
    }));
}
