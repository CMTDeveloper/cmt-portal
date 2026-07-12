import { z } from 'zod';
import { programKeySchema } from './offering';

// Per-child snapshot of the grade/level for THIS enrollment's school year.
// Enables a child's Bala Vihar "journey" across years without a new collection.
export const LevelSnapshotSchema = z.object({
  schoolGrade: z.string().nullable(), // grade that year ("3","JK") or null for shishu
  levelId: z.string().nullable(),     // matched level id, or null if no match
  levelName: z.string().nullable(),   // denormalized for display ("Level 2","Shishu Vihar")
});
export type LevelSnapshot = z.infer<typeof LevelSnapshotSchema>;

export const EnrollmentDocSchema = z.object({
  eid: z.string().min(1),
  fid: z.string().min(1),
  oid: z.string().min(1),
  programKey: programKeySchema,
  programLabel: z.string().min(1),
  termLabel: z.string().min(1),
  location: z.string().min(1).nullable(),
  enrolledAt: z.date(),
  enrolledVia: z.enum(['family-initiated', 'first-attendance', 'welcome-team', 'promotion', 'kiosk']),
  enrolledByMid: z.string().nullable(),
  enrolledMids: z.array(z.string()),
  suggestedAmountSnapshot: z.number().int().nonnegative(),
  suggestedAmountOverride: z.number().int().positive().nullable(),
  status: z.enum(['active', 'cancelled']),
  cancelledAt: z.date().nullable(),
  cancelledReason: z.string().nullable(),
  // Roster join key (deriveRoster queries where('pid','==',level.pid)). Optional
  // on read for back-compat; ALWAYS written going forward.
  pid: z.string().optional(),
  // Per-mid grade/level snapshot for this enrollment's year. Keyed by mid.
  levelSnapshots: z.record(z.string(), LevelSnapshotSchema).optional(),
});

export type EnrollmentDoc = z.infer<typeof EnrollmentDocSchema>;

export const PostEnrollmentBodySchema = z.object({
  oid: z.string().min(1),
});

export type PostEnrollmentBody = z.infer<typeof PostEnrollmentBodySchema>;

export const WelcomePostEnrollmentBodySchema = z.object({
  fid: z.string().min(1),
  oid: z.string().min(1),
});

export type WelcomePostEnrollmentBody = z.infer<typeof WelcomePostEnrollmentBodySchema>;

export const OverrideEnrollmentBodySchema = z.object({
  suggestedAmountOverride: z.number().int().positive().nullable(),
});

export type OverrideEnrollmentBody = z.infer<typeof OverrideEnrollmentBodySchema>;

export const ResolveActivePeriodParamsSchema = z.object({
  location: z.string().min(1),
  programKey: programKeySchema,
});

export type ResolveActivePeriodParams = z.infer<typeof ResolveActivePeriodParamsSchema>;
