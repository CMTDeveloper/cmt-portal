import type { MemberDoc } from './schemas/member';

/**
 * Single source of truth for the per-type "required member info" matrix (owner
 * spec 2026-06-22). Consumed by the capture forms (client markers), the member
 * write routes (POST/PATCH), the registration route, AND the post-sign-in
 * profile-completion gate — so every path agrees on what "complete" means.
 *
 * Required-ness is enforced here + at the write routes, NEVER by tightening the
 * read-validated MemberDocSchema (that would break every already-migrated doc).
 *
 * Matrix:
 *   ALL members  : firstName, lastName, gender (Male|Female), type, foodAllergies
 *   ADULTS  only : email, phone, volunteeringSkills (>= 1)   (optional for children)
 *   CHILDREN only: schoolGrade, birthMonthYear                (optional for adults)
 */

// The value the "No known allergies" affordance writes, so a family can satisfy
// the required foodAllergies field without inventing an allergy.
export const NO_ALLERGIES = 'None';

/**
 * Whole-string answers that mean "no allergy". `NO_ALLERGIES` is what the
 * checkbox writes; the rest are what people type into the free-text box to say
 * the same thing. Compared after trim + lowercase, and only ever WHOLE-string -
 * see `recordedAllergy`.
 */
const NO_ALLERGY_ANSWERS: ReadonlySet<string> = new Set([
  NO_ALLERGIES.toLowerCase(),
  'none.',
  'no',
  'no.',
  'n/a',
  'na',
  'nil',
  'no allergies',
  'no known allergies',
  'no known allergy',
]);

/**
 * The allergy a member has actually recorded, or null if they recorded that
 * they have none. The READER half of `NO_ALLERGIES` - use it everywhere an
 * allergy is displayed or turned into a safety marker.
 *
 * Why this exists: the "No known allergies" affordance writes the literal
 * string 'None', and for two months every reader asked only whether the field
 * was a non-empty string. On 2026-08-05 production held 105 members with a
 * value - 104 of them exactly 'None', and ONE real ("nuts, pollen"). All 105
 * rendered as a severe allergy: a red dot on the teacher's attendance marker
 * and class list, and a red "severe" callout on both student profiles and the
 * staff family page. The cost is not the wrong badge, it is that 104 false
 * markers teach a teacher to stop reading the one that is real.
 *
 * The comparison is WHOLE-STRING on purpose. An allergy is often phrased as a
 * negative - "no nuts", "none except dairy" - and hiding one of those is worse
 * than the noise this removes, so anything not matched exactly is returned as
 * a real allergy. When in doubt, show the warning.
 */
export function recordedAllergy(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  return NO_ALLERGY_ANSWERS.has(text.toLowerCase()) ? null : text;
}

export type MemberRequiredField =
  | 'firstName'
  | 'lastName'
  | 'gender'
  | 'type'
  | 'foodAllergies'
  | 'email'
  | 'phone'
  | 'volunteeringSkills'
  | 'schoolGrade'
  | 'birthMonthYear';

export const REQUIRED_ALL: readonly MemberRequiredField[] = [
  'firstName',
  'lastName',
  'gender',
  'type',
  'foodAllergies',
];
export const REQUIRED_ADULT: readonly MemberRequiredField[] = ['email', 'phone', 'volunteeringSkills'];
export const REQUIRED_CHILD: readonly MemberRequiredField[] = ['schoolGrade', 'birthMonthYear'];

/**
 * The fields needed to judge completeness. MemberDoc is assignable to this; a
 * form draft (fields possibly undefined/empty) is too. `type` is required
 * because it selects the matrix.
 *
 * Every value field accepts `undefined` as well as `null` — with
 * `exactOptionalPropertyTypes` on, a present-but-`undefined` value (the natural
 * "no value yet" from optional form state and zod `.optional()` fields) would
 * otherwise be a type error at every caller. `undefined` is treated exactly like
 * `null`/empty here: MISSING. This keeps the helper callable from the capture
 * forms, the write/register routes, and the gate with one shape.
 */
export interface MemberCompletenessInput {
  type: 'Adult' | 'Child';
  gender?: string | null | undefined;
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  foodAllergies?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  volunteeringSkills?: readonly string[] | null | undefined;
  schoolGrade?: string | null | undefined;
  birthMonthYear?: string | null | undefined;
}

/**
 * Does this member still take part?
 *
 * The ONE place the rule "absent ⇒ active" is written down. Every consumer -
 * gates, rosters, kiosk, prasad, seva, enrollment - must ask through here rather
 * than testing `m.participation === 'inactive'` inline, because the interesting
 * case is the ABSENT field: all 2033 migrated member docs predate it, and a
 * hand-written `=== 'active'` check would silently treat every one of them as
 * not participating and empty the school.
 *
 * Accepts a loose shape so a MemberDoc, a projection, or a raw Firestore
 * `data()` can all be passed without casting.
 */
export function isParticipating(
  member: { participation?: string | null | undefined } | null | undefined,
): boolean {
  return member?.participation !== 'inactive';
}

/** The full required-field list for a given member type. */
export function requiredFieldsForType(type: 'Adult' | 'Child'): MemberRequiredField[] {
  return [...REQUIRED_ALL, ...(type === 'Adult' ? REQUIRED_ADULT : REQUIRED_CHILD)];
}

function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Whether a single required field is satisfied on a member. */
export function memberFieldComplete(member: MemberCompletenessInput, field: MemberRequiredField): boolean {
  switch (field) {
    case 'type':
      return member.type === 'Adult' || member.type === 'Child';
    case 'gender':
      // PreferNotToSay (the internal sentinel) and absent both count as MISSING —
      // human capture must yield Male or Female.
      return member.gender === 'Male' || member.gender === 'Female';
    case 'volunteeringSkills':
      return Array.isArray(member.volunteeringSkills) && member.volunteeringSkills.length >= 1;
    case 'foodAllergies':
      // Any non-empty string satisfies it, including the NO_ALLERGIES sentinel.
      return nonEmptyString(member.foodAllergies);
    case 'firstName':
      return nonEmptyString(member.firstName);
    case 'lastName':
      return nonEmptyString(member.lastName);
    case 'email':
      return nonEmptyString(member.email);
    case 'phone':
      return nonEmptyString(member.phone);
    case 'schoolGrade':
      return nonEmptyString(member.schoolGrade);
    case 'birthMonthYear':
      return nonEmptyString(member.birthMonthYear);
  }
}

/**
 * Human labels for the required fields, for telling someone what is missing.
 *
 * Lives here, next to the field list itself, so a new `MemberRequiredField` is a
 * TYPE ERROR until it gets a label - a `Partial<Record<...>>` copy per screen
 * silently renders the raw key instead. The register form and the
 * complete-profile form share this; the two `*_ERROR` maps in the register route
 * and `write-member.ts` are deliberately NOT folded in, because those are
 * server-side refusal messages ("Email is required to..."), not field names.
 */
export const MEMBER_FIELD_LABEL: Record<MemberRequiredField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  gender: 'Gender',
  type: 'Member type',
  foodAllergies: 'Food allergies',
  email: 'Email',
  phone: 'Phone',
  volunteeringSkills: 'Volunteering skills',
  schoolGrade: 'School grade',
  birthMonthYear: 'Birth month & year',
};

/** The required fields a member is still missing (empty ⇒ complete). */
export function whatsMissingForMember(member: MemberCompletenessInput): MemberRequiredField[] {
  return requiredFieldsForType(member.type).filter((f) => !memberFieldComplete(member, f));
}

/** Whether a member satisfies every required field for its type. */
export function isMemberComplete(member: MemberCompletenessInput): boolean {
  return whatsMissingForMember(member).length === 0;
}

/**
 * For a whole family: the members that are still incomplete, with what each is
 * missing. The post-sign-in gate (manager scope) blocks while this is non-empty.
 */
export function incompleteMembers(
  members: readonly (MemberDoc | (MemberCompletenessInput & { mid: string }))[],
): { mid: string; missing: MemberRequiredField[] }[] {
  const out: { mid: string; missing: MemberRequiredField[] }[] = [];
  for (const m of members) {
    const missing = whatsMissingForMember(m);
    if (missing.length > 0) out.push({ mid: m.mid, missing });
  }
  return out;
}

/**
 * The members a given session is responsible for completing before the
 * profile-completion gate passes.
 *
 * - A plain member → only their own record.
 * - A manager → their own record PLUS every non-manager member (children /
 *   dependents added without their own login). Other managers (co-managers, e.g.
 *   an invited spouse who accepted with `manager: true`) complete their OWN
 *   profile via their OWN login, so they are EXCLUDED from another manager's set.
 *   Otherwise an invited co-manager's half-filled record would trap the original
 *   manager on /complete-profile forever, unable to finish someone else's fields.
 *
 * The /family gate and the /complete-profile form MUST both scope through this
 * one helper so they can never disagree on who blocks whom (a mismatch bounces
 * the user /complete-profile ⇄ /family).
 */
export function membersRequiringCompletion<
  T extends {
    mid: string;
    manager?: boolean | null;
    inviteStatus?: string | null | undefined;
    participation?: string | null | undefined;
  },
>(members: readonly T[], currentMid: string, isManager: boolean): T[] {
  // A pending-invite member (created at invite-send, not yet accepted) is nobody's
  // completion task: they have no session and complete their OWN profile after
  // accepting. Drop them up-front so neither the invitee nor any manager is ever
  // blocked by a pending row.
  //
  // An INACTIVE member is dropped for the same reason, from the other end: they
  // have finished, or never took part. Reported 2026-08-02 - a father could not
  // finish registration because the portal demanded a school grade for a son who
  // had already completed Bala Vihar, and contact details for a spouse who was
  // not taking part. There was no way to say so, so the family was simply stuck.
  //
  // Note this asks about PARTICIPATION, not about whether their record is tidy:
  // `incompleteMembers()` still reports an inactive member's missing fields, so
  // staff can see the gap. This helper only decides who BLOCKS.
  const active = members.filter(
    (m) => m.inviteStatus !== 'pending' && m.participation !== 'inactive',
  );
  if (!isManager) return active.filter((m) => m.mid === currentMid);
  return active.filter((m) => m.mid === currentMid || m.manager !== true);
}
