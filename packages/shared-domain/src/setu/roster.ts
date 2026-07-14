import { z } from 'zod';

export const ROSTER_PAYMENTS = ['paid', 'outstanding', 'unknown'] as const;
export type RosterPayment = (typeof ROSTER_PAYMENTS)[number];

// NOTE: the paginated browse contract (RosterFamilyRow / RosterListResponse /
// RosterQuery) was retired with the /api/welcome/families route. The single-page
// report supersedes it - see roster-report.ts (RosterReportRow + the pure
// matchesRosterFilters/summarizeRoster). The two schemas below are still shared by
// the roster CSV export (RosterPersonCsvRow) and the migration reconciliation strip.

export const RosterPersonCsvRowSchema = z.object({
  familyName: z.string(),
  fid: z.string(),
  legacyFid: z.string(),
  memberName: z.string(),
  type: z.string(), // 'Adult' | 'Child'
  grade: z.string(),
  level: z.string(), // BV enrollment level name, '' for adults / non-BV members
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
