// packages/shared-domain/src/setu/reports.ts
import { z } from 'zod';
import { programKeySchema } from './schemas/offering';

export const REPORT_KINDS = ['enrollment', 'attendance', 'donations'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

// v1 report filters: `program` (all kinds) and `from`/`to` (attendance only —
// the route fills defaults; donations is all-time by donation-period, and the
// donations/enrollment data carry no clean location field, so `location` is
// intentionally NOT a report filter in v1 — see the Phase 4 plan deviations).
export const ReportQuerySchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  from: YMD.optional(),
  to: YMD.optional(),
  program: programKeySchema.optional(),
});
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

export const EnrollmentReportSchema = z.object({
  byProgram: z.array(z.object({
    programKey: z.string(), programLabel: z.string(),
    families: z.number().int().nonnegative(), members: z.number().int().nonnegative(),
  })),
  byLevel: z.array(z.object({
    levelId: z.string(), levelName: z.string(), programKey: z.string(),
    members: z.number().int().nonnegative(),
  })),
  totalActiveEnrollments: z.number().int().nonnegative(),
  totalMembers: z.number().int().nonnegative(),
});
export type EnrollmentReport = z.infer<typeof EnrollmentReportSchema>;

const AttendanceRowSchema = z.object({
  present: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative(),
  late: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  rate: z.number().min(0).max(1), // (present + late) / total
});
export const AttendanceReportSchema = z.object({
  byLevel: z.array(AttendanceRowSchema.extend({ levelId: z.string(), levelName: z.string(), programKey: z.string() })),
  byProgram: z.array(AttendanceRowSchema.extend({ programKey: z.string(), programLabel: z.string() })),
  from: z.string(), to: z.string(),
  totalEvents: z.number().int().nonnegative(),
});
export type AttendanceReport = z.infer<typeof AttendanceReportSchema>;

export const DonationsReportSchema = z.object({
  byPeriod: z.array(z.object({
    pid: z.string(), label: z.string(), programLabel: z.string(),
    completedCAD: z.number().nonnegative(), completedCount: z.number().int().nonnegative(),
  })),
  byProgram: z.array(z.object({
    programKey: z.string(), programLabel: z.string(),
    completedCAD: z.number().nonnegative(), completedCount: z.number().int().nonnegative(),
  })),
  paidFamilies: z.number().int().nonnegative(),
  outstandingFamilies: z.number().int().nonnegative(),
  totalCompletedCAD: z.number().nonnegative(),
});
export type DonationsReport = z.infer<typeof DonationsReportSchema>;
