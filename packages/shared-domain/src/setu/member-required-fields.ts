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
