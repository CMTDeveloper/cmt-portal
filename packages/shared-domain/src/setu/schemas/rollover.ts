import { z } from 'zod';

export const SchoolYearLabelSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, 'Use a school year like 2026-27')
  .refine((value) => {
    const start = Number(value.slice(0, 4));
    const end = Number(value.slice(5, 7));
    return end === (start + 1) % 100;
  }, 'School year must advance by one year');
export type SchoolYearLabel = z.infer<typeof SchoolYearLabelSchema>;

export const SchoolYearConfigSchema = z.object({
  currentYear: SchoolYearLabelSchema,
});
export type SchoolYearConfig = z.infer<typeof SchoolYearConfigSchema>;

export const PromotionOutcomeKind = z.enum([
  'advance', 'graduate', 'shishu-stays', 'shishu-aged-out', 'needs-grade',
]);

export const PromotionRowSchema = z.object({
  fid: z.string(), mid: z.string(), childName: z.string(),
  location: z.string().nullable(),
  outcomeKind: PromotionOutcomeKind,
  fromGrade: z.string().nullable(), fromLevelName: z.string().nullable(),
  toGrade: z.string().nullable(), toLevelName: z.string().nullable(),
});
export type PromotionRow = z.infer<typeof PromotionRowSchema>;

export const RolloverReportSchema = z.object({
  fromYear: z.string(), toYear: z.string(), dryRun: z.boolean(),
  familiesProcessed: z.number().int(), familiesSkippedAlreadyPromoted: z.number().int(),
  promoted: z.number().int(), advanced: z.number().int(), shishuStayed: z.number().int(),
  graduated: z.number().int(), needsAttention: z.number().int(),
  byTransition: z.array(z.object({ label: z.string(), count: z.number().int() })),
  graduates: z.array(PromotionRowSchema),
  attention: z.array(PromotionRowSchema),
  rows: z.array(PromotionRowSchema),
  // The fids actually mutated on a commit run (uncapped — unlike `rows`, which is
  // capped at COMMIT_ROW_CAP). Empty on dry-run. Used to revalidate every affected
  // family's cache, not just the first capped page of child rows.
  affectedFids: z.array(z.string()).default([]),
});
export type RolloverReport = z.infer<typeof RolloverReportSchema>;

export const StartYearResultSchema = z.object({
  fromYear: z.string(), toYear: z.string(),
  offeringsCreated: z.array(z.string()), offeringsExisting: z.array(z.string()),
  levelsCreated: z.array(z.string()), levelsExisting: z.array(z.string()),
  donationPeriodsCreated: z.array(z.string()),
});
export type StartYearResult = z.infer<typeof StartYearResultSchema>;

export const CalendarCopyResultSchema = z.object({
  fromYear: z.string(),
  toYear: z.string(),
  created: z.array(z.string()),
  existing: z.array(z.string()),
});
export type CalendarCopyResult = z.infer<typeof CalendarCopyResultSchema>;

// Request bodies (shared web↔native). Years optional → engine defaults.
export const StartYearBodySchema = z.object({
  fromYear: SchoolYearLabelSchema.optional(), toYear: SchoolYearLabelSchema.optional(),
});
export const PromoteBodySchema = z.object({
  fromYear: SchoolYearLabelSchema.optional(), toYear: SchoolYearLabelSchema.optional(),
  dryRun: z.boolean(),
});
