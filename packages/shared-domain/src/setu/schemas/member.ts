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
  // Co-manager invite lifecycle (Feature B). Set to 'pending' when the member is
  // created at invite-SEND (so the invited person is visible to the family before
  // they accept); cleared to null on accept. Absent/null ⇒ a normal active member.
  // A pending member has uid:null, is NOT in family.managers, and has no
  // contactKey until accept — so it is excluded from the profile-completion gate
  // and shows an "Invite pending" badge instead of a missing-fields count.
  inviteStatus: z.enum(['pending']).nullable().optional(),
  // ── Does this person still take part? ─────────────────────────────────────
  //
  // Absent ⇒ active. It can NEVER be required on read: all 2033 migrated docs
  // predate it. Required-ness is enforced at the write routes, as with every
  // other member rule.
  //
  // Deliberately a THIRD concept, not a reuse of the two above:
  //   portalAccess  - may they sign in?
  //   inviteStatus  - have they accepted an invite?
  //   participation - do they still attend?
  // A co-manager can be portalAccess:'active' and participation:'inactive' the
  // year they stop coming. Reported 2026-08-02: a family had no way to say "my
  // son finished Bala Vihar" or "my spouse isn't taking part", so the profile
  // gate demanded a school grade for a graduate and contact details for someone
  // who never signed up. This is a disable, never a delete - the person, their
  // attendance and their donation history all stay.
  participation: z.enum(['active', 'inactive']).optional(),
  inactiveAt: z.date().nullable().optional(),
  // Where the deactivation came from, so a bulk migration decision can be told
  // apart from a family's own choice (and reversed separately if it was wrong).
  inactiveSource: z.enum(['family', 'legacy-migration']).nullable().optional(),
  // Set by the annual rollover when a child ages out of the programme. Distinct
  // from participation: a graduate may well stay on as an adult member. Without
  // it a grade-12 graduate is indistinguishable from a current grade-12 student.
  graduatedAt: z.date().nullable().optional(),
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
  // 5-digit sequential Member ID (issue #4), e.g. '50001'. The canonical,
  // user-facing member identifier (replaces the legacy SID for humans); the
  // `${fid}-NN` `mid` above stays the internal doc-id / join key. Optional: read-validated.
  publicMid: z.string().nullable().optional(),
  volunteeringSkills: z.array(z.string()),
  foodAllergies: z.string().nullable(),
  // Deprecated: emergency contact moved to the family level (families.familyEmergencyContact).
  // Kept for backward compat + existing docs; both slots nullable since it is no longer collected.
  emergencyContacts: z.tuple([EmergencyContactSchema.nullable(), EmergencyContactSchema.nullable()]),
});

export type MemberDoc = z.infer<typeof MemberDocSchema>;
