import { z } from 'zod';
import { programKeySchema, PROGRAM_TERM_TYPES, ADULT_STUDY_CLASS } from './offering';

export const MEMBER_TYPES = ['child', 'adult', 'any'] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];

export const ATTENDANCE_MODES = ['none', 'check-in', 'teacher'] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

export const ProgramEligibilitySchema = z
  .object({
    memberType: z.enum(MEMBER_TYPES),
    minAgeYears: z.number().int().min(0).max(120).optional(),
    maxAgeYears: z.number().int().min(0).max(120).optional(),
  })
  .refine(
    (e) => e.minAgeYears == null || e.maxAgeYears == null || e.minAgeYears <= e.maxAgeYears,
    { message: 'minAgeYears must be <= maxAgeYears', path: ['maxAgeYears'] },
  );
export type ProgramEligibility = z.infer<typeof ProgramEligibilitySchema>;

export const ProgramCapabilitiesSchema = z.object({
  usesOfferings: z.boolean(),
  usesDonation: z.boolean(),
  usesLevels: z.boolean(),
  usesCalendar: z.boolean(),
  attendanceMode: z.enum(ATTENDANCE_MODES),
  /**
   * This program IS an Adult Study Class: the "one parent stays on site" ask.
   * Ticking it puts the program behind the adult-class gate and the bespoke
   * `/adult-class` selection screen.
   *
   * ── Why a capability and not the programKey ──────────────────────────────
   * The flow was pinned to the literal key `adult-study-class`. Scarborough's
   * class was then created as its own program, `adult-study-east`, and the gate
   * could never fire for it - so a Scarborough family enrolled, paid, and was
   * never asked who attends, with nothing anywhere saying why (reported
   * 2026-07-29). An admin can invent any programKey; a hardcoded one silently
   * supports exactly the one centre that happened to be seeded first.
   *
   * ── `.optional()`, with NO `.default(false)` ─────────────────────────────
   * This schema validates on READ, so a required field would reject every
   * program doc written before today. And a default would be worse than absent:
   * `ProgramForm` rebuilds this whole object on save, so a writer that omitted
   * the key would silently persist `false` and un-flag the program - the
   * erase-on-partial-write trap. Readers must therefore test `=== true`, which
   * `isAdultStudyClassProgram` does for them.
   */
  isAdultStudyClass: z.boolean().optional(),
});
export type ProgramCapabilities = z.infer<typeof ProgramCapabilitiesSchema>;

export const ProgramDocSchema = z.object({
  programKey: programKeySchema,
  label: z.string().min(1),
  shortDescription: z.string().default(''),
  status: z.enum(['active', 'draft', 'archived']),
  locations: z.array(z.string().min(1)), // [] = location-less
  termType: z.enum(PROGRAM_TERM_TYPES),
  eligibility: ProgramEligibilitySchema,
  capabilities: ProgramCapabilitiesSchema,
  displayOrder: z.number().int().min(0),
  createdAt: z.date(),
  createdBy: z.string().min(1),
  updatedAt: z.date(),
  updatedBy: z.string().min(1),
});
export type ProgramDoc = z.infer<typeof ProgramDocSchema>;

export const CreateProgramSchema = z.object({
  programKey: programKeySchema.optional(),
  label: z.string().min(1),
  shortDescription: z.string().default(''),
  status: z.enum(['active', 'draft', 'archived']).default('draft'),
  locations: z.array(z.string().min(1)).default([]),
  termType: z.enum(PROGRAM_TERM_TYPES),
  eligibility: ProgramEligibilitySchema,
  capabilities: ProgramCapabilitiesSchema,
  displayOrder: z.number().int().min(0).default(0),
});
export type CreateProgramInput = z.infer<typeof CreateProgramSchema>;

export const UpdateProgramSchema = CreateProgramSchema.partial().omit({ programKey: true });
export type UpdateProgramInput = z.infer<typeof UpdateProgramSchema>;

/**
 * Is this program an Adult Study Class?
 *
 * The capability is the answer, EXCEPT that the original `adult-study-class`
 * program counts whatever its doc says. That fallback is deliberate and is not
 * dead weight: the Brampton class works today purely because the code matched
 * that literal key, and its doc carries no capability yet. Reading only the flag
 * would break the one centre that currently works the moment this deploys, and
 * leave it broken until somebody happened to open the admin form and tick a box.
 *
 * Remove the fallback only after every environment's `adult-study-class` doc has
 * `capabilities.isAdultStudyClass: true` - and check prod, not just UAT.
 *
 * Takes the narrowest shape that answers the question, so callers can pass a
 * ProgramDoc, an admin form row, or a test fixture without casting.
 */
export function isAdultStudyClassProgram(program: {
  programKey: string;
  // `Partial<ProgramCapabilities>`, not a lone `{ isAdultStudyClass?: boolean }`.
  // The latter is a WEAK type - every property optional - so TypeScript rejects a
  // full capabilities object with "no properties in common" (TS2559), which is
  // exactly what every real caller passes.
  capabilities?: Partial<ProgramCapabilities> | undefined;
}): boolean {
  // An EXPLICIT boolean always wins - including `false`. Testing only for `true`
  // and falling through left the checkbox unable to turn itself off for the one
  // program named `adult-study-class`: an admin could untick it, save
  // successfully, and the program stayed classified as an adult class forever.
  // A control that cannot express one of its two states is worse than no
  // control, because the admin is told the save worked.
  const flag = program.capabilities?.isAdultStudyClass;
  if (typeof flag === 'boolean') return flag;
  // ABSENT only: the legacy key. Its doc carries no capability yet, and reading
  // only the flag would break Brampton the moment this deployed.
  return program.programKey === ADULT_STUDY_CLASS;
}

/** Whole years between a 'YYYY-MM' birth month and now (null when unknown/malformed). */
function ageYears(birthMonthYear: string | null, now: Date): number | null {
  if (!birthMonthYear) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(birthMonthYear);
  if (!m) return null;
  const months = (now.getUTCFullYear() - Number(m[1])) * 12 + (now.getUTCMonth() + 1 - Number(m[2]));
  return Math.floor(months / 12);
}

/** Coarse program-level eligibility gate (levels still refine placement for BV). */
export function memberEligibleForProgram(
  member: { type: 'Adult' | 'Child'; birthMonthYear: string | null },
  eligibility: ProgramEligibility,
  now: Date,
): boolean {
  if (eligibility.memberType === 'child' && member.type !== 'Child') return false;
  if (eligibility.memberType === 'adult' && member.type !== 'Adult') return false;
  const age = ageYears(member.birthMonthYear, now);
  if (age != null) {
    if (eligibility.minAgeYears != null && age < eligibility.minAgeYears) return false;
    if (eligibility.maxAgeYears != null && age > eligibility.maxAgeYears) return false;
  }
  return true; // unknown age never causes a false-negative
}
