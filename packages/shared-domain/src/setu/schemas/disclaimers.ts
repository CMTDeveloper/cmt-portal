import { z } from 'zod';

// One disclaimer section. Read-schema — NO .min() on title/body (doc schemas
// validate on READ; non-empty is enforced at the admin write route + editor).
export const DisclaimerSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
});
export type DisclaimerSection = z.infer<typeof DisclaimerSectionSchema>;

// The admin-editable content doc (app_config/disclaimers). version is a positive
// int bumped on each publish that changes content. updatedAt/updatedBy are
// write-only bookkeeping, optional on read.
export const DisclaimersConfigSchema = z.object({
  version: z.number().int().positive(),
  sections: z.array(DisclaimerSectionSchema),
  updatedAt: z.unknown().optional(),
  updatedBy: z.string().optional(),
});
export type DisclaimersConfig = z.infer<typeof DisclaimersConfigSchema>;

// The per-family acceptance record surfaced on the FamilyDoc. acceptedAt (a
// Firestore Timestamp) is written by the record helper but intentionally NOT
// surfaced here — the predicate only needs schoolYear + version.
export const DisclaimerAcceptanceSchema = z.object({
  schoolYear: z.string(),
  version: z.number().int(),
  acceptedByMid: z.string(),
});
export type DisclaimerAcceptance = z.infer<typeof DisclaimerAcceptanceSchema>;
