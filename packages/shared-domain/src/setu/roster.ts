import { z } from 'zod';
import { LOCATIONS, programKeySchema } from './schemas/offering';

export const ROSTER_PAYMENTS = ['paid', 'outstanding', 'unknown'] as const;
export type RosterPayment = (typeof ROSTER_PAYMENTS)[number];

export const RosterFamilyRowSchema = z.object({
  fid: z.string(),
  legacyFid: z.string().nullable(),
  name: z.string(),
  location: z.string(),
  memberCount: z.number().int().nonnegative(),
  payment: z.enum(ROSTER_PAYMENTS),
  programs: z.array(z.string()), // active program labels, for display + CSV
});
export type RosterFamilyRow = z.infer<typeof RosterFamilyRowSchema>;

export const RosterListResponseSchema = z.object({
  families: z.array(RosterFamilyRowSchema),
  nextCursor: z.string().nullable(), // last fid of this page, or null when no more
  total: z.number().int().nonnegative().nullable(), // total family count (first page only), else null
});
export type RosterListResponse = z.infer<typeof RosterListResponseSchema>;

export const RosterQuerySchema = z.object({
  q: z.string().trim().optional(),
  location: z.enum(LOCATIONS).optional(),
  program: programKeySchema.optional(),
  cursor: z.string().optional(), // last fid from the prior page
  limit: z.coerce.number().int().min(1).max(100).default(50),
  format: z.enum(['json', 'csv']).default('json'),
});
export type RosterQuery = z.infer<typeof RosterQuerySchema>;

export const RosterPersonCsvRowSchema = z.object({
  familyName: z.string(),
  fid: z.string(),
  legacyFid: z.string(),
  memberName: z.string(),
  type: z.string(), // 'Adult' | 'Child'
  grade: z.string(),
  location: z.string(),
  programs: z.string(), // '; '-joined active program labels
  payment: z.string(),
});
export type RosterPersonCsvRow = z.infer<typeof RosterPersonCsvRowSchema>;

export const MigrationStatusResponseSchema = z.object({
  legacyTotal: z.number().int().nonnegative(),
  migrated: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  missingFids: z.array(z.string()), // capped sample of legacy fids absent from Setu
  checkedAt: z.string(), // ISO timestamp
});
export type MigrationStatusResponse = z.infer<typeof MigrationStatusResponseSchema>;
