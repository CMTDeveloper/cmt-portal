import { z } from 'zod';
import { LOCATIONS, programKeySchema, PROGRAM_TERM_TYPES } from './offering';

export const MEMBER_TYPES = ['child', 'adult', 'any'] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];

export const ATTENDANCE_MODES = ['none', 'check-in', 'teacher'] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

export const ProgramEligibilitySchema = z.object({
  memberType: z.enum(MEMBER_TYPES),
  minAgeYears: z.number().int().min(0).max(120).optional(),
  maxAgeYears: z.number().int().min(0).max(120).optional(),
});
export type ProgramEligibility = z.infer<typeof ProgramEligibilitySchema>;

export const ProgramCapabilitiesSchema = z.object({
  usesOfferings: z.boolean(),
  usesDonation: z.boolean(),
  usesLevels: z.boolean(),
  usesCalendar: z.boolean(),
  attendanceMode: z.enum(ATTENDANCE_MODES),
});
export type ProgramCapabilities = z.infer<typeof ProgramCapabilitiesSchema>;

export const ProgramDocSchema = z.object({
  programKey: programKeySchema,
  label: z.string().min(1),
  shortDescription: z.string().default(''),
  status: z.enum(['active', 'draft', 'archived']),
  locations: z.array(z.enum(LOCATIONS)), // [] = location-less
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
  programKey: programKeySchema,
  label: z.string().min(1),
  shortDescription: z.string().default(''),
  status: z.enum(['active', 'draft', 'archived']).default('draft'),
  locations: z.array(z.enum(LOCATIONS)).default([]),
  termType: z.enum(PROGRAM_TERM_TYPES),
  eligibility: ProgramEligibilitySchema,
  capabilities: ProgramCapabilitiesSchema,
  displayOrder: z.number().int().min(0).default(0),
});
export type CreateProgramInput = z.infer<typeof CreateProgramSchema>;

export const UpdateProgramSchema = CreateProgramSchema.partial().omit({ programKey: true });
export type UpdateProgramInput = z.infer<typeof UpdateProgramSchema>;

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
