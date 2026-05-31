import { z } from 'zod';
import { LOCATIONS, programKeySchema } from './offering';

export const EnrollmentDocSchema = z.object({
  eid: z.string().min(1),
  fid: z.string().min(1),
  oid: z.string().min(1),
  programKey: programKeySchema,
  programLabel: z.string().min(1),
  termLabel: z.string().min(1),
  location: z.enum(LOCATIONS).nullable(),
  enrolledAt: z.date(),
  enrolledVia: z.enum(['family-initiated', 'first-attendance', 'welcome-team']),
  enrolledByMid: z.string().nullable(),
  enrolledMids: z.array(z.string()),
  suggestedAmountSnapshot: z.number().int().nonnegative(),
  suggestedAmountOverride: z.number().int().positive().nullable(),
  status: z.enum(['active', 'cancelled']),
  cancelledAt: z.date().nullable(),
  cancelledReason: z.string().nullable(),
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
  location: z.enum(LOCATIONS),
  programKey: programKeySchema,
});

export type ResolveActivePeriodParams = z.infer<typeof ResolveActivePeriodParamsSchema>;
