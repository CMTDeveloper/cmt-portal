import { z } from 'zod';
import { LOCATIONS, PROGRAM_KEYS } from './donation-period';

export const EnrollmentDocSchema = z.object({
  eid: z.string().min(1),
  fid: z.string().min(1),
  pid: z.string().min(1),
  programLabel: z.string().min(1),
  periodLabel: z.string().min(1),
  location: z.enum(LOCATIONS),
  enrolledAt: z.date(),
  enrolledVia: z.enum(['family-initiated', 'first-attendance', 'welcome-team']),
  enrolledByMid: z.string().nullable(),
  childrenMids: z.array(z.string()),
  suggestedAmountSnapshot: z.number().int().positive(),
  suggestedAmountOverride: z.number().int().positive().nullable(),
  status: z.enum(['active', 'cancelled']),
  cancelledAt: z.date().nullable(),
  cancelledReason: z.string().nullable(),
});

export type EnrollmentDoc = z.infer<typeof EnrollmentDocSchema>;

export const PostEnrollmentBodySchema = z.object({
  pid: z.string().min(1),
});

export type PostEnrollmentBody = z.infer<typeof PostEnrollmentBodySchema>;

export const WelcomePostEnrollmentBodySchema = z.object({
  fid: z.string().min(1),
  pid: z.string().min(1),
});

export type WelcomePostEnrollmentBody = z.infer<typeof WelcomePostEnrollmentBodySchema>;

export const OverrideEnrollmentBodySchema = z.object({
  suggestedAmountOverride: z.number().int().positive().nullable(),
});

export type OverrideEnrollmentBody = z.infer<typeof OverrideEnrollmentBodySchema>;

export const ResolveActivePeriodParamsSchema = z.object({
  location: z.enum(LOCATIONS),
  programKey: z.enum(PROGRAM_KEYS),
});

export type ResolveActivePeriodParams = z.infer<typeof ResolveActivePeriodParamsSchema>;
