// packages/shared-domain/src/setu/reports.ts
import { z } from 'zod';
import { programKeySchema } from './schemas/offering';

export const REPORT_KINDS = ['enrollment', 'attendance'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

// v1 report filters: `program` (all kinds) and `from`/`to` (attendance only —
// the route fills defaults; the enrollment data carries no clean location field,
// so `location` is intentionally NOT a report filter in v1 — see the Phase 4 plan
// deviations).
export const ReportQuerySchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  from: YMD.optional(),
  to: YMD.optional(),
  program: programKeySchema.optional(),
  // School-year scope ("2025-26"). When set, enrollment/attendance are filtered to
  // that year (in-memory, index-free). Omitted ⇒ unscoped (all-time / all-families).
  // The SchoolYearSwitcher omits it for the live year on purpose.
  year: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

export const EnrollmentReportSchema = z.object({
  byProgram: z.array(z.object({
    programKey: z.string(), programLabel: z.string(),
    families: z.number().int().nonnegative(), members: z.number().int().nonnegative(),
    // issue #23 — present only on the bala-vihar group: how many of its
    // `families` are engagement-confirmed vs merely registered. Optional so
    // non-BV groups omit them; when present, confirmed + registered === families.
    confirmed: z.number().int().nonnegative().optional(),
    registered: z.number().int().nonnegative().optional(),
  })),
  byLevel: z.array(z.object({
    levelId: z.string(), levelName: z.string(), programKey: z.string(),
    // Disambiguating context from the level's offering: same level NAME ("Level 1")
    // can exist across locations/years, so the UI shows "Level 1 · Brampton · 2026-27".
    location: z.string().nullable().optional(),
    termLabel: z.string().optional(),
    members: z.number().int().nonnegative(),
  })),
  totalActiveEnrollments: z.number().int().nonnegative(),
  totalMembers: z.number().int().nonnegative(),
});
export type EnrollmentReport = z.infer<typeof EnrollmentReportSchema>;

const AttendanceRowSchema = z.object({
  present: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  rate: z.number().min(0).max(1), // present / total
});
export const AttendanceReportSchema = z.object({
  byLevel: z.array(AttendanceRowSchema.extend({
    levelId: z.string(), levelName: z.string(), programKey: z.string(),
    // Same-named levels exist across locations/years (the report is unscoped for
    // the live year); carry the offering's location + term so the UI can show
    // "Level 1 · Brampton · 2026-27" instead of two indistinguishable "Level 1".
    location: z.string().nullable().optional(),
    termLabel: z.string().optional(),
  })),
  byProgram: z.array(AttendanceRowSchema.extend({ programKey: z.string(), programLabel: z.string() })),
  from: z.string(), to: z.string(),
  totalEvents: z.number().int().nonnegative(),
});
export type AttendanceReport = z.infer<typeof AttendanceReportSchema>;
