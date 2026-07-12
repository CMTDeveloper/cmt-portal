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

// Canadian provinces/territories for the family home-address dropdown (code + label).
export const CANADIAN_PROVINCES = [
  { code: 'ON', name: 'Ontario' },
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' },
] as const;

// Light Canadian postal-code check (A1A 1A1, optional space). Kept lenient on
// case/space; the write routes + forms normalize.
export const CANADIAN_POSTAL_RE = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

export const FamilyAddressSchema = z.object({
  street: z.string().min(1),
  unit: z.string().optional().default(''),
  city: z.string().min(1),
  province: z.string().min(1),
  postalCode: z.string().regex(CANADIAN_POSTAL_RE),
});
export type FamilyAddress = z.infer<typeof FamilyAddressSchema>;

/** A family's address counts as complete only when the required parts are present. */
export function isFamilyAddressComplete(family: { familyAddress?: FamilyAddress | null | undefined }): boolean {
  const a = family.familyAddress;
  return !!(a && a.street && a.city && a.province && a.postalCode);
}

export const FamilyDocSchema = z.object({
  fid: z.string().min(1),
  legacyFid: z.string().nullable(),
  name: z.string().min(1),
  location: z.string().min(1),
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
  // Required family-level home address (collected at registration / profile
  // completion). Nullable + optional here because doc schemas validate on READ
  // and pre-feature docs lack it; required-ness is enforced at the write routes,
  // forms, and the profile-completion gate - NEVER by tightening this read field.
  familyAddress: FamilyAddressSchema.nullable().optional(),
  // Slice 2: version-tracked disclaimer acceptance (per-family; the manager
  // accepts). Optional + nullable — absence reads as "never accepted".
  disclaimersAccepted: DisclaimerAcceptanceSchema.nullable().optional(),
});

export type FamilyDoc = z.infer<typeof FamilyDocSchema>;
