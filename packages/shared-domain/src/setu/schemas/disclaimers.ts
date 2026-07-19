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
//
// `intro` is the preamble shown above the sections; `acknowledgement` is the
// binding statement shown above the single "I Acknowledge" action. Both are
// read-tolerant (optional, default '') so a config written before these fields
// existed still parses — non-empty is enforced only where it matters (the
// acknowledgement always renders; an empty intro just hides that block).
export const DisclaimersConfigSchema = z.object({
  version: z.number().int().positive(),
  intro: z.string().optional().default(''),
  sections: z.array(DisclaimerSectionSchema),
  acknowledgement: z.string().optional().default(''),
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
