import { memberMatchesLevel, type LevelDoc, type LevelSnapshot } from '@cmt/shared-domain';

export const DEFAULT_FROM_YEAR = '2025-26';
export const DEFAULT_TO_YEAR = deriveNextSchoolYear(DEFAULT_FROM_YEAR);

const BV_LOCATIONS = ['brampton', 'scarborough'] as const;
export const BV_SOURCE_OIDS = balaViharSourceOidsForYear(DEFAULT_FROM_YEAR);

/** "2025-26" -> "2026-27". */
export function deriveNextSchoolYear(currentYear: string): string {
  const year = currentYear.trim();
  const match = /^(\d{4})-(\d{2})$/.exec(year);
  if (!match) throw new Error(`Invalid school year: ${currentYear}`);

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end !== (start + 1) % 100) throw new Error(`Invalid school year: ${currentYear}`);

  const nextStart = start + 1;
  const nextEnd = String((nextStart + 1) % 100).padStart(2, '0');
  return `${nextStart}-${nextEnd}`;
}

/** Bala Vihar offering ids follow `bv-{location}-{schoolYear}`. */
export function balaViharSourceOidsForYear(year: string): string[] {
  const slug = year.trim().toLowerCase();
  return BV_LOCATIONS.map((location) => `bv-${location}-${slug}`);
}

/** Swap the term-slug suffix of an oid: bv-brampton-2025-26 → bv-brampton-2026-27. */
export function targetOidOf(sourceOid: string, fromYear: string, toYear: string): string {
  const fromSlug = fromYear.trim().toLowerCase();
  const toSlug = toYear.trim().toLowerCase();
  if (sourceOid.endsWith(`-${fromSlug}`)) return sourceOid.slice(0, -fromSlug.length) + toSlug;
  return `${sourceOid}-${toSlug}`; // defensive fallback
}

type LevelLite = Pick<LevelDoc, 'levelId' | 'levelName' | 'levelKind' | 'gradeBand'>;

/** Match a member to a level among `levels` and return the snapshot (level may be null). */
export function buildLevelSnapshot(
  member: { schoolGrade: string | null; birthMonthYear: string | null },
  levels: LevelLite[],
  now: Date,
): LevelSnapshot {
  const match = levels.find((lv) =>
    memberMatchesLevel(
      { type: 'Child', schoolGrade: member.schoolGrade, birthMonthYear: member.birthMonthYear },
      lv,
      now,
    ),
  );
  return {
    schoolGrade: member.schoolGrade,
    levelId: match?.levelId ?? null,
    levelName: match?.levelName ?? null,
  };
}
