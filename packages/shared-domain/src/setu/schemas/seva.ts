import { z } from 'zod';

export const SevaRequirementConfigSchema = z.object({
  hoursPerYear: z.number().int().positive(),
  currentSevaYear: z.string().min(1).nullable(),
});
export type SevaRequirementConfig = z.infer<typeof SevaRequirementConfigSchema>;

export const SevaOpportunityStatus = z.enum(['open', 'closed']);
export type SevaOpportunityStatusType = z.infer<typeof SevaOpportunityStatus>;

export const SevaOpportunityDocSchema = z.object({
  oppId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  date: z.date(),
  location: z.string(),
  defaultHours: z.number().positive(),
  capacity: z.number().int().positive().nullable(),
  sevaYear: z.string().min(1),
  status: SevaOpportunityStatus,
  createdAt: z.date(),
  createdBy: z.string(),
  updatedAt: z.date(),
  updatedBy: z.string(),
});
export type SevaOpportunityDoc = z.infer<typeof SevaOpportunityDocSchema>;

export const CreateSevaOpportunitySchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  date: z.string().min(1),
  location: z.string().max(200).optional().default(''),
  defaultHours: z.number().positive().max(100),
  capacity: z.number().int().positive().max(10000).nullable().optional().default(null),
});
export type CreateSevaOpportunityInput = z.infer<typeof CreateSevaOpportunitySchema>;

export const UpdateSevaOpportunitySchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    date: z.string().min(1).optional(),
    location: z.string().max(200).optional(),
    defaultHours: z.number().positive().max(100).optional(),
    capacity: z.number().int().positive().max(10000).nullable().optional(),
    status: SevaOpportunityStatus.optional(),
  })
  .strict();
export type UpdateSevaOpportunityInput = z.infer<typeof UpdateSevaOpportunitySchema>;
