import { z } from 'zod';

export const FamilyDocSchema = z.object({
  fid: z.string().min(1),
  legacyFid: z.string().nullable(),
  name: z.string().min(1),
  location: z.enum(['Brampton', 'Mississauga', 'Scarborough', 'Markham']),
  createdAt: z.date(),
  managers: z.array(z.string()).min(1),
  searchKeys: z.array(z.string()),
});

export type FamilyDoc = z.infer<typeof FamilyDocSchema>;
