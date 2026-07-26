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

/**
 * Whether this viewer must be asked to confirm the family's centre.
 *
 * THE single expression for that question. It is consumed by six sites that
 * must agree exactly - both gates in app/family/layout.tsx, and four places in
 * complete-profile-form (the load short-circuit, the Save-enable predicate, the
 * PATCH body, and the selector's render condition). They drifted apart trivially
 * when each spelled it out, and the two failure modes are opposite and both bad:
 * too strict and every family loops on the completion screen, too loose and
 * nobody is ever asked.
 *
 * Manager-scoped, because only a manager can edit family-level data - gating a
 * plain member on it would strand them on a form with no control they can use.
 *
 * `=== true` is deliberate. The field is `boolean | null | undefined`: absent or
 * null means the family was never flagged, `false` means they were asked and
 * have answered, and only `true` means "still needs asking".
 */
export function needsCentreConfirmation(
  family: { locationNeedsConfirmation?: boolean | null | undefined },
  isManager: boolean,
): boolean {
  return isManager && family.locationNeedsConfirmation === true;
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
  // True when `location` above is a MIGRATION GUESS rather than the family's
  // stated centre: the legacy roster carried no recognisable `center`, so the
  // parser defaulted to Brampton. The profile gate diverts such a manager to
  // /complete-profile to pick their real centre, and the PATCH clears this.
  //
  // Carried as an additive marker rather than by emptying `location`, because
  // `location` is a read-validated z.string().min(1) and many consumers
  // (grade-eligible, roster filters, level matching, search) assume a string.
  // Nullable + optional so it is safe on read for every pre-existing doc: only
  // the literal `true` means "ask".
  locationNeedsConfirmation: z.boolean().nullable().optional(),
});

export type FamilyDoc = z.infer<typeof FamilyDocSchema>;
