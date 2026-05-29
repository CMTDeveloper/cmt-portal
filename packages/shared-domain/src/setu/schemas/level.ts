import { z } from 'zod';
import { PROGRAM_KEYS, LOCATIONS } from './donation-period';
import { toSafeSlug } from '../../utils/slug';

// A Bala Vihar "class" is a Level at a location for a period. Level names and
// grade-bands differ by location (West/Brampton vs East/Scarborough), so the
// grade→level mapping is NOT global — it lives on each level's gradeBand.
export const LEVEL_KINDS = ['shishu', 'pre-level', 'level', 'parents'] as const;
export type LevelKind = (typeof LEVEL_KINDS)[number];

// Shishu Vihar age window (months). 1.5y = 18 months; below JK/SK (≈5y = 60mo).
export const SHISHU_MIN_MONTHS = 18;
export const SHISHU_MAX_MONTHS = 60; // exclusive — a 5yo is pre-level (JK/SK), not shishu

/** Firestore doc-ID slug for a level name, e.g. "Level 2" → "level-2". */
export function levelSlug(levelName: string): string {
  return toSafeSlug(levelName);
}

export const LevelDocSchema = z.object({
  levelId: z.string().min(1), // `{location}-{levelSlug}-{pid}`
  programKey: z.enum(PROGRAM_KEYS),
  location: z.enum(LOCATIONS),
  levelName: z.string().min(1),
  levelKind: z.enum(LEVEL_KINDS),
  order: z.number().int().min(0),
  gradeBand: z.array(z.string()), // school grades this level covers; [] for shishu/parents
  ageLabel: z.string().min(1),
  curriculum: z.string().min(1),
  pid: z.string().min(1),
  periodLabel: z.string().min(1),
  teacherRefs: z.array(z.string()), // mids/tids of assigned teachers (denormalized for "my levels")
  enabled: z.boolean(),
  createdAt: z.date(),
  createdBy: z.string().min(1),
  updatedAt: z.date(),
  updatedBy: z.string().min(1),
});

export type LevelDoc = z.infer<typeof LevelDocSchema>;

// level / pre-level require a non-empty gradeBand; shishu / parents must not.
function gradeBandConsistent(d: { levelKind: LevelKind; gradeBand: string[] }): boolean {
  if (d.levelKind === 'level' || d.levelKind === 'pre-level') return d.gradeBand.length > 0;
  return true;
}

export const CreateLevelSchema = z
  .object({
    programKey: z.enum(PROGRAM_KEYS),
    location: z.enum(LOCATIONS),
    pid: z.string().min(1),
    levelName: z.string().min(1),
    levelKind: z.enum(LEVEL_KINDS),
    order: z.number().int().min(0),
    gradeBand: z.array(z.string()).default([]),
    ageLabel: z.string().min(1),
    curriculum: z.string().min(1),
    enabled: z.boolean().default(true),
  })
  .refine(gradeBandConsistent, {
    message: 'level and pre-level require a non-empty gradeBand',
    path: ['gradeBand'],
  });

export type CreateLevelInput = z.infer<typeof CreateLevelSchema>;

export const UpdateLevelSchema = z
  .object({
    levelName: z.string().min(1).optional(),
    levelKind: z.enum(LEVEL_KINDS).optional(),
    order: z.number().int().min(0).optional(),
    gradeBand: z.array(z.string()).optional(),
    ageLabel: z.string().min(1).optional(),
    curriculum: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (d) => {
      // Only enforce band consistency when both levelKind + gradeBand are present
      // (a partial PATCH may touch only one; the route reads the existing doc).
      if (d.levelKind && d.gradeBand) {
        return gradeBandConsistent({ levelKind: d.levelKind, gradeBand: d.gradeBand });
      }
      return true;
    },
    { message: 'level and pre-level require a non-empty gradeBand', path: ['gradeBand'] },
  );

export type UpdateLevelInput = z.infer<typeof UpdateLevelSchema>;

/**
 * Normalize a free-text / legacy school-grade label for matching. schoolGrade
 * is entered free-text ("Grade 3") on the member form but stored as a bare
 * number ("3") by the legacy migration — and gradeBands are admin-edited. We
 * normalize both sides so "Grade 3" / "Gr 3" / "3" all match. JK/SK and other
 * non-numeric labels collapse to a lowercased trimmed token.
 *   "Grade 3" → "3"   "Gr. 2" → "2"   "JK" → "jk"   "Kindergarten" → "kindergarten"
 */
export function normalizeGrade(grade: string): string {
  const cleaned = grade.trim().toLowerCase().replace(/\./g, '');
  const m = /^(?:grade|gr)\s*(\d{1,2})$/.exec(cleaned);
  if (m) return m[1]!;
  const num = /^(\d{1,2})$/.exec(cleaned);
  if (num) return num[1]!;
  return cleaned.replace(/\s+/g, ' ');
}

/** Whole months between a 'YYYY-MM' birth month and a reference date. */
function ageInMonths(birthMonthYear: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(birthMonthYear);
  if (!m) return null;
  const birthY = Number(m[1]);
  const birthM = Number(m[2]); // 1-12
  if (birthM < 1 || birthM > 12) return null;
  const nowY = now.getUTCFullYear();
  const nowM = now.getUTCMonth() + 1; // 1-12
  return (nowY - birthY) * 12 + (nowM - birthM);
}

/**
 * Does a member belong on a level's roster? Pure predicate driving §6 roster
 * derivation. Grade-band lives on the level (banding is per-location), so this
 * never hardcodes a grade→level map.
 *  - level / pre-level → a Child whose schoolGrade ∈ gradeBand
 *  - shishu            → a Child aged 1.5–4 (from birthMonthYear)
 *  - parents           → an Adult
 */
export function memberMatchesLevel(
  member: { type: 'Adult' | 'Child'; schoolGrade: string | null; birthMonthYear: string | null },
  level: { levelKind: LevelKind; gradeBand: string[] },
  now: Date,
): boolean {
  switch (level.levelKind) {
    case 'parents':
      return member.type === 'Adult';
    case 'level':
    case 'pre-level': {
      if (member.type !== 'Child' || member.schoolGrade == null) return false;
      const g = normalizeGrade(member.schoolGrade);
      return level.gradeBand.some((band) => normalizeGrade(band) === g);
    }
    case 'shishu': {
      if (member.type !== 'Child' || member.birthMonthYear == null) return false;
      const months = ageInMonths(member.birthMonthYear, now);
      if (months == null) return false;
      return months >= SHISHU_MIN_MONTHS && months < SHISHU_MAX_MONTHS;
    }
    default:
      return false;
  }
}
