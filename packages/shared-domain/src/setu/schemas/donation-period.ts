import { z } from 'zod';

export const PROGRAM_KEYS = ['bala-vihar'] as const;
export type ProgramKey = (typeof PROGRAM_KEYS)[number];

export const LOCATIONS = ['Brampton', 'Mississauga', 'Scarborough', 'Markham'] as const;
export type Location = (typeof LOCATIONS)[number];

export const DonationPeriodDocSchema = z.object({
  pid: z.string().min(1),
  programKey: z.enum(PROGRAM_KEYS),
  programLabel: z.string().min(1),
  location: z.enum(LOCATIONS),
  periodLabel: z.string().min(1),
  startDate: z.date(),
  endDate: z.date(),
  suggestedAmount: z.number().int().min(1),
  amountTiers: z.array(z.number().int().min(1)).min(1),
  enabled: z.boolean(),
  createdAt: z.date(),
  createdBy: z.string().min(1),
  updatedAt: z.date(),
  updatedBy: z.string().min(1),
});

export type DonationPeriodDoc = z.infer<typeof DonationPeriodDocSchema>;

// Schema for POST (create) requests — pid + audit fields are server-generated
export const CreateDonationPeriodSchema = z.object({
  programKey: z.enum(PROGRAM_KEYS),
  location: z.enum(LOCATIONS),
  periodLabel: z.string().min(1),
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
  suggestedAmount: z.number().int().min(1),
  amountTiers: z.array(z.number().int().min(1)).min(1),
  enabled: z.boolean().default(true),
}).refine(
  (d) => new Date(d.endDate) > new Date(d.startDate),
  { message: 'endDate must be after startDate', path: ['endDate'] },
);

export type CreateDonationPeriodInput = z.infer<typeof CreateDonationPeriodSchema>;

// Schema for PATCH (update) requests — all fields optional except structural invariants
export const UpdateDonationPeriodSchema = z.object({
  periodLabel: z.string().min(1).optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  suggestedAmount: z.number().int().min(1).optional(),
  amountTiers: z.array(z.number().int().min(1)).min(1).optional(),
  enabled: z.boolean().optional(),
}).refine(
  (d) => {
    if (d.startDate && d.endDate) {
      return new Date(d.endDate) > new Date(d.startDate);
    }
    return true;
  },
  { message: 'endDate must be after startDate', path: ['endDate'] },
);

export type UpdateDonationPeriodInput = z.infer<typeof UpdateDonationPeriodSchema>;
