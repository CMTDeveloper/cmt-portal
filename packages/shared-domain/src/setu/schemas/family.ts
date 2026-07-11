import { z } from 'zod';
import { DisclaimerAcceptanceSchema } from './disclaimers';

export const FAMILY_RELATION_OPTIONS = [
  'Mother', 'Father', 'Grandmother', 'Grandfather', 'Sibling', 'Other family member',
] as const;

export const FamilyEmergencyContactSchema = z.object({
  relation: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().optional().default(''),
});
export type FamilyEmergencyContact = z.infer<typeof FamilyEmergencyContactSchema>;

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
  // Single optional family-level emergency contact (manager-editable). Replaces
  // the deprecated per-member emergencyContacts. Nullable + optional: absence /
  // null both read as "none on file".
  familyEmergencyContact: FamilyEmergencyContactSchema.nullable().optional(),
  // Slice 2: version-tracked disclaimer acceptance (per-family; the manager
  // accepts). Optional + nullable — absence reads as "never accepted".
  disclaimersAccepted: DisclaimerAcceptanceSchema.nullable().optional(),
});

export type FamilyDoc = z.infer<typeof FamilyDocSchema>;
