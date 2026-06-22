import { z } from 'zod';

const EmergencyContactSchema = z.object({
  relation: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().min(1),
});

export const MemberDocSchema = z.object({
  mid: z.string().min(1),
  uid: z.string().nullable(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  type: z.enum(['Adult', 'Child']),
  gender: z.enum(['Male', 'Female', 'PreferNotToSay']),
  manager: z.boolean(),
  joinedAt: z.date(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  // Plaintext alternate contacts for display/management in "My contacts".
  // contactKeys store only hashes, so the readable values must live here.
  // Invariant: every value here has a matching contactKey → this member's mid.
  altEmails: z.array(z.string()).default([]),
  altPhones: z.array(z.string()).default([]),
  // One-time post-sign-in "add your other contacts" nudge. Null/absent =
  // not yet dismissed (show it); a Date = dismissed (never show again).
  contactsNudgeDismissedAt: z.date().nullable().optional(),
  // One-time post-sign-in "set your volunteering skills" nudge (adults only,
  // shown until they add a skill or dismiss). Same null/absent/Date semantics.
  volunteeringSkillsNudgeDismissedAt: z.date().nullable().optional(),
  // optional; absent ⇒ active. Only the legacy-migration path sets 'pending' (gates non-manager portal access).
  portalAccess: z.enum(['active', 'pending']).optional(),
  schoolGrade: z.string().nullable(),
  birthMonthYear: z.string().nullable(),
  // Birth month only (1-12), no year — the legacy roster's `dob_m`. Used by the
  // prasad assigner. Derived from birthMonthYear when that exists.
  birthMonth: z.number().int().min(1).max(12).nullable().optional(),
  // Legacy roster student id (sid), captured at migration / backfilled, so the
  // portal can map this member to their records in the check-in app's
  // family-check-ins collection (which keys students by sid). Null for members
  // with no legacy student row (new portal kids, adults).
  legacySid: z.string().nullable().optional(),
  volunteeringSkills: z.array(z.string()),
  foodAllergies: z.string().nullable(),
  emergencyContacts: z.tuple([EmergencyContactSchema, EmergencyContactSchema.nullable()]),
});

export type MemberDoc = z.infer<typeof MemberDocSchema>;
