import { normalizeGrade, SHISHU_MIN_MONTHS, SHISHU_MAX_MONTHS } from './schemas/level';

// Ordered rungs. JK & SK precede Grade 1; Grade 12 is terminal (graduates).
export const GRADE_LADDER = ['JK', 'SK', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;

export type PromotionOutcome =
  | { kind: 'advance'; from: string; to: string }
  | { kind: 'graduate'; from: '12' }
  | { kind: 'shishu-stays' }
  | { kind: 'shishu-aged-out' }
  | { kind: 'needs-grade' };

// Normalized ladder index map. JK/SK lowercased to match normalizeGrade output.
const LADDER_INDEX = new Map<string, number>(
  GRADE_LADDER.map((g, i) => [normalizeGrade(g), i]),
);

function ageInMonths(birthMonthYear: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(birthMonthYear);
  if (!m) return null;
  const by = Number(m[1]); const bm = Number(m[2]);
  if (bm < 1 || bm > 12) return null;
  return (now.getUTCFullYear() - by) * 12 + (now.getUTCMonth() + 1 - bm);
}

/**
 * Decide a child's promotion outcome from their member fields. Single source of
 * truth — used by both the dry-run preview and the commit engine.
 */
export function decidePromotion(
  member: { schoolGrade: string | null; birthMonthYear: string | null },
  now: Date,
): PromotionOutcome {
  if (member.schoolGrade != null && member.schoolGrade.trim() !== '') {
    const g = normalizeGrade(member.schoolGrade);
    const idx = LADDER_INDEX.get(g);
    if (idx == null) return { kind: 'needs-grade' };          // off-ladder ("kindergarten","13")
    if (idx === GRADE_LADDER.length - 1) return { kind: 'graduate', from: '12' };
    return { kind: 'advance', from: GRADE_LADDER[idx]!, to: GRADE_LADDER[idx + 1]! };
  }
  if (member.birthMonthYear == null) return { kind: 'needs-grade' };
  const months = ageInMonths(member.birthMonthYear, now);
  if (months == null) return { kind: 'needs-grade' };
  if (months >= SHISHU_MIN_MONTHS && months < SHISHU_MAX_MONTHS) return { kind: 'shishu-stays' };
  if (months >= SHISHU_MAX_MONTHS) return { kind: 'shishu-aged-out' };
  return { kind: 'needs-grade' };
}
