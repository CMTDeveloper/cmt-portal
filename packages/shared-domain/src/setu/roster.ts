import { z } from 'zod';
import { LOCATIONS, programKeySchema } from './schemas/offering';

export const ROSTER_PAYMENTS = ['paid', 'outstanding', 'unknown'] as const;
export type RosterPayment = (typeof ROSTER_PAYMENTS)[number];

export const RosterFamilyRowSchema = z.object({
  fid: z.string(),
  publicFid: z.string().nullable(),
  legacyFid: z.string().nullable(),
  name: z.string(),
  location: z.string(),
  memberCount: z.number().int().nonnegative(),
  payment: z.enum(ROSTER_PAYMENTS),
  programs: z.array(z.string()), // active program labels, for display + CSV
  // issue #23 — Bala Vihar engagement for the roster chip:
  //   'confirmed'  = active BV enrollment AND engaged (attended ≥1 class, a
  //                  completed donation for its eid, or legacy-paid),
  //   'registered' = active BV enrollment but not yet engaged,
  //   null/absent  = no active BV enrollment.
  // Nullable + optional (read-validation discipline — never required).
  bvEngagement: z.enum(['confirmed', 'registered']).nullable().optional(),
});
export type RosterFamilyRow = z.infer<typeof RosterFamilyRowSchema>;

export const RosterListResponseSchema = z.object({
  families: z.array(RosterFamilyRowSchema),
  nextCursor: z.string().nullable(), // last fid of this page, or null when no more
  // Count of families matching the CURRENTLY-APPLIED filters (program+location,
  // or location, or none). Present on the first page only (null on later pages).
  total: z.number().int().nonnegative().nullable(),
});
export type RosterListResponse = z.infer<typeof RosterListResponseSchema>;

export const RosterQuerySchema = z.object({
  // NOTE: free-text search is NOT a server param here — the roster screen calls
  // the existing welcome-team search endpoint (`searchFamilies`) client-side when
  // the search box is non-empty, and shows browse (this query) when it's empty.
  // Keeping `q` out of this schema avoids a silently-ignored param.
  location: z.enum(LOCATIONS).optional(),
  program: programKeySchema.optional(),
  // School-year scope ("2025-26"). When set, the roster lists only families with
  // an active enrollment in that year (in-memory filter on the enrollments read,
  // index-free). Omitted ⇒ unscoped (every family, the live-year behavior).
  year: z.string().regex(/^\d{4}-\d{2}$/).optional(),
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
