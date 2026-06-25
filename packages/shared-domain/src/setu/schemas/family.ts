import { z } from 'zod';

export const FamilyDocSchema = z.object({
  fid: z.string().min(1),
  legacyFid: z.string().nullable(),
  name: z.string().min(1),
  location: z.enum(['Brampton', 'Mississauga', 'Scarborough', 'Markham']),
  createdAt: z.date(),
  managers: z.array(z.string()).min(1),
  searchKeys: z.array(z.string()),
  // 4-digit sequential Family ID (issue #4), e.g. '1042'. Additive + user-facing;
  // the CMT- `fid` above remains the internal doc-id / join key. Optional because
  // doc schemas validate on read and pre-migration docs lack it.
  publicFid: z.string().nullable().optional(),
});

export type FamilyDoc = z.infer<typeof FamilyDocSchema>;
