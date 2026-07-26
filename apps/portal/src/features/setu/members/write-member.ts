import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { allocateMemberPublicIds } from '@/features/setu/ids/public-id-allocator';
import { nextMemberMid } from '@/features/setu/ids/member-mid';
import { syncActiveEnrollmentMemberships } from '@/features/setu/enrollment/sync-enrollment-members';
import { revokeMemberSessions, RESURRECTABLE_SEVAK_CAPS } from '@/features/setu/auth/revoke-sessions';
import { assertNotLastManager, LastManagerError } from '@/features/setu/members';
import { writeAuditLog } from '@/features/setu/audit/audit-log';
import {
  whatsMissingForMember,
  type MemberRequiredField,
  type MemberCompletenessInput,
} from '@cmt/shared-domain';

/**
 * The one place a member document is created, changed or removed.
 *
 * Both the family self-serve routes (`/api/setu/members*`) and the staff
 * cross-family routes call through here, so a rule added for one applies to the
 * other by construction. The required-field matrix moves in with the
 * transactions deliberately: it sits OUTSIDE the transaction, and leaving it
 * behind would let a staff route create a Child with no grade and no birth
 * month - which immediately traps that family on its own /complete-profile
 * gate.
 *
 * Auth stays at the route. This module answers "what does a valid member write
 * do", never "who is allowed to do it".
 */

/**
 * Who is performing a STAFF write. `null` means family self-serve, which writes
 * no audit row - the log exists to answer "which staff member changed this?",
 * and burying that in every family's own edits defeats it.
 */
export interface Actor {
  uid: string;
  mid: string | null;
  /** The session's PRIMARY role. */
  role: string;
  /**
   * The actor's other roles. A welcome-team volunteer is usually also a parent,
   * so `role` alone is `family-manager` and the staff capability that actually
   * authorized this write lives here.
   */
  extraRoles: string[];
}

/** A refused write, carrying the exact response body the routes return. */
export interface WriteFailure {
  ok: false;
  status: number;
  body: Record<string, unknown>;
}

export type AddMemberResult = { ok: true; mid: string } | WriteFailure;
export type MutateMemberResult = { ok: true } | WriteFailure;

// Emergency contact: only `relation` is required to be non-empty when the
// object is present. Phone and email are independently optional (you may have
// one, both, or neither - Bala Vihar families often have a relation name we
// know without their digital contact info on file). The client should send
// `null` when the user filled in nothing.
const emergencyContactSchema = z
  .object({
    relation: z.string().min(1),
    phone: z.string().optional().default(''),
    email: z.string().optional().default(''),
  })
  .nullable();

// Use .nullish() (== nullable + optional) on every optional string field so
// the client can safely send `null` for empty values (its natural
// "no value here" sentinel) without zod rejecting the whole body.
export const addMemberSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  type: z.enum(['Adult', 'Child']),
  // Capture/write enum is Male|Female only. The read-validated MemberDocSchema
  // keeps 'PreferNotToSay' for the 3 internal sentinel-minting paths; this WRITE
  // route does not accept it (the profile-completion matrix treats it as missing).
  gender: z.enum(['Male', 'Female']),
  email: z.string().email().nullish(),
  phone: z.string().min(7).nullish(),
  schoolGrade: z.string().nullish(),
  birthMonthYear: z.string().nullish(),
  birthMonth: z.number().int().min(1).max(12).nullish(),
  foodAllergies: z.string().nullish(),
  volunteeringSkills: z.array(z.string()).nullish(),
  emergencyContacts: z.tuple([emergencyContactSchema, emergencyContactSchema]).nullish(),
});

// Immutable fields - cannot be patched by anyone
export const patchMemberSchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    type: z.enum(['Adult', 'Child']).optional(),
    // Capture/write enum is Male|Female only. The read-validated MemberDocSchema
    // keeps 'PreferNotToSay' for the 3 internal sentinel-minting paths; this
    // WRITE route does not accept it.
    gender: z.enum(['Male', 'Female']).optional(),
    manager: z.boolean().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().min(7).nullable().optional(),
    schoolGrade: z.string().nullable().optional(),
    birthMonthYear: z.string().nullable().optional(),
    birthMonth: z.number().int().min(1).max(12).nullable().optional(),
    foodAllergies: z.string().nullable().optional(),
    volunteeringSkills: z.array(z.string()).optional(),
    emergencyContacts: z
      .tuple([
        z.object({ relation: z.string(), phone: z.string(), email: z.string() }).nullable(),
        z.object({ relation: z.string(), phone: z.string(), email: z.string() }).nullable(),
      ])
      .optional(),
  })
  .strict(); // rejects mid, uid, joinedAt

// Maps a missing required field (from the shared matrix) to the 400 error code
// the write routes return. Adult email/phone collapse to one `contact-required`.
// `volunteeringSkills` reuses the pre-existing `skills-required` code.
// firstName/lastName/gender/type are already enforced by the zod schemas, so
// they are never surfaced from here (they are also absent from the order below,
// which is what actually decides what a caller sees).
const REQUIRED_FIELD_ERROR: Record<MemberRequiredField, string | null> = {
  firstName: null,
  lastName: null,
  gender: null,
  type: null,
  foodAllergies: 'foodAllergies-required',
  email: 'contact-required',
  phone: 'contact-required',
  volunteeringSkills: 'skills-required',
  schoolGrade: 'grade-required',
  birthMonthYear: 'birthmonth-required',
};

// Order in which a missing-field 400 is surfaced, so the error code is
// deterministic when several fields are missing at once.
const REQUIRED_FIELD_ORDER: MemberRequiredField[] = [
  'foodAllergies',
  'volunteeringSkills',
  'email',
  'phone',
  'schoolGrade',
  'birthMonthYear',
];

/**
 * Picks the first unsatisfied required field (in REQUIRED_FIELD_ORDER) out of a
 * set of missing fields and returns its 400 error code, or null if none of the
 * enforced fields are missing.
 */
function pickFirstRequiredError(missing: MemberRequiredField[]): string | null {
  const missingSet = new Set(missing);
  for (const field of REQUIRED_FIELD_ORDER) {
    if (missingSet.has(field)) {
      return REQUIRED_FIELD_ERROR[field];
    }
  }
  return null;
}

/**
 * The 400 code for the first required field an ADD is missing, or null.
 *
 * The full per-type matrix applies: an add supplies the whole member, so there
 * is nothing to be lenient about.
 */
export function firstMissingRequiredField(input: MemberCompletenessInput): string | null {
  return pickFirstRequiredError(whatsMissingForMember(input));
}

/**
 * The 400 code for the first required field a PATCH would leave unsatisfied, or
 * null.
 *
 * Deliberately more lenient than the add scope, and this is the difference that
 * matters: a rule fires only when the field is IN SCOPE - the patch touches it,
 * or the patch flips `type` and so re-evaluates every required field for the new
 * type. A partial patch that leaves a still-missing field alone is NOT blocked,
 * because legacy-incomplete docs must stay editable; blocking would strand a
 * family on a screen that cannot fix the field.
 *
 * @param merged      the member as it would look AFTER the patch applies
 * @param patch       the parsed patch body, used for `field in patch` scoping
 * @param typeChanged whether the patch flips `type` (widens scope to everything)
 */
export function firstMissingRequiredFieldForPatch(
  merged: MemberCompletenessInput,
  patch: Record<string, unknown>,
  typeChanged: boolean,
): string | null {
  const missing = whatsMissingForMember(merged).filter((field) => typeChanged || field in patch);
  return pickFirstRequiredError(missing);
}

// 'YYYY-MM' -> month number (1-12), or null if unparseable/absent. The capture
// matrix requires birthMonthYear on children; birthMonth is the derived index
// the prasad engine + reminders read.
function deriveBirthMonth(birthMonthYear: string | null | undefined): number | null {
  if (typeof birthMonthYear !== 'string') return null;
  const m = /^\d{4}-(\d{2})$/.exec(birthMonthYear.trim());
  if (!m) return null;
  const month = Number(m[1]);
  return month >= 1 && month <= 12 ? month : null;
}

// A child can't be born in the future. `birthMonthYear` is 'YYYY-MM', which sorts
// lexically, so a plain string compare against the current month is enough.
function isFutureBirthMonthYear(birthMonthYear: string | null | undefined): boolean {
  if (typeof birthMonthYear !== 'string') return false;
  const ym = birthMonthYear.trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return false;
  const now = new Date();
  const nowYm = `${now.getUTCFullYear()}-${(now.getUTCMonth() + 1).toString().padStart(2, '0')}`;
  return ym > nowYm;
}

/**
 * Reconcile the family's active-enrollment rosters after a member change.
 *
 * Best-effort: the member write already committed, so a sync hiccup must not
 * fail the request. The next member change (or the retro-sweep) reconciles.
 * Without it a child added AFTER the family enrolled never joins the enrollment
 * (`enrolledMids`), so the dashboard, roster and attendance silently omit them -
 * the N=2 bug.
 */
async function syncEnrollments(fid: string, label: string): Promise<void> {
  try {
    await syncActiveEnrollmentMemberships(fid);
  } catch (err) {
    console.error(`[members:${label}] enrollment membership sync failed for`, fid, err);
  }
}

/** Projection of a member doc onto the fields a patch is about to write. */
function beforeValues(
  memberData: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = memberData[key] ?? null;
  return out;
}

/**
 * Add a member to `fid`.
 *
 * `actor` is the staff member performing a cross-family add, or null for a
 * family's own manager (which writes no audit row).
 */
export async function addMember(args: {
  fid: string;
  body: unknown;
  actor: Actor | null;
}): Promise<AddMemberResult> {
  const { fid, actor } = args;

  const parsed = addMemberSchema.safeParse(args.body);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { error: 'bad-request', issues: parsed.error.issues } };
  }

  const data = parsed.data;

  // Per-type required-field matrix (owner spec 2026-06-22), enforced via the
  // single shared source of truth. This covers the pre-existing adult
  // skills-required guard (issue #10) plus foodAllergies (all), adult
  // email/phone (contact-required), and child grade/birthMonthYear.
  const missingError = firstMissingRequiredField({
    type: data.type,
    gender: data.gender,
    firstName: data.firstName,
    lastName: data.lastName,
    foodAllergies: data.foodAllergies ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    volunteeringSkills: data.volunteeringSkills ?? [],
    schoolGrade: data.schoolGrade ?? null,
    birthMonthYear: data.birthMonthYear ?? null,
  });
  if (missingError) {
    return { ok: false, status: 400, body: { error: missingError } };
  }

  // A child's birth month/year can't be in the future.
  if (isFutureBirthMonthYear(data.birthMonthYear)) {
    return { ok: false, status: 400, body: { error: 'birthdate-future' } };
  }

  // birthMonth (1-12) is derived from birthMonthYear ('YYYY-MM') on every write
  // that sets it, so the client never has to keep the two in sync. An explicit
  // body.birthMonth is honoured only when birthMonthYear is absent.
  const birthMonth = deriveBirthMonth(data.birthMonthYear) ?? data.birthMonth ?? null;

  const db = portalFirestore();

  const emailHash = data.email ? hashContactKey('email', data.email) : null;
  const phoneHash = data.phone ? hashContactKey('phone', data.phone) : null;

  // Allocate the new member's user-facing 5-digit publicMid BEFORE the txn opens -
  // the allocator runs its own Firestore transaction and Firestore forbids nested
  // transactions. One member is added per request, so we allocate exactly one.
  const newPublicMid = (await allocateMemberPublicIds(1))[0]!;

  let mid: string;
  try {
    mid = await db.runTransaction(async (txn) => {
      const familyRef = db.collection('families').doc(fid);
      const familySnap = await txn.get(familyRef);
      if (!familySnap.exists) {
        throw new Error('family-not-found');
      }

      const membersSnap = await txn.get(
        db.collection('families').doc(fid).collection('members'),
      );

      // Verify any contactKey we're about to write doesn't already belong to a
      // different family. Without this, a manager could overwrite another
      // family's contactKey pointer (contact-key theft, same pattern as Slice 2b M2).
      const [emailSnap, phoneSnap] = await Promise.all([
        emailHash ? txn.get(db.collection('contactKeys').doc(emailHash)) : Promise.resolve(null),
        phoneHash ? txn.get(db.collection('contactKeys').doc(phoneHash)) : Promise.resolve(null),
      ]);
      if (emailSnap && emailSnap.exists) {
        const existing = emailSnap.data() as { fid?: string } | undefined;
        if (existing?.fid && existing.fid !== fid) {
          throw new Error('contact-conflict:email');
        }
      }
      if (phoneSnap && phoneSnap.exists) {
        const existing = phoneSnap.data() as { fid?: string } | undefined;
        if (existing?.fid && existing.fid !== fid) {
          throw new Error('contact-conflict:phone');
        }
      }

      // Collision-free: highest existing suffix + 1, NOT member count (count+1
      // reuses a deleted member's slot and the txn.set below would overwrite them).
      const newMid = nextMemberMid(fid, (membersSnap.docs as Array<{ id: string }>).map((d) => d.id));
      const now = FieldValue.serverTimestamp();

      const memberFields = {
        mid: newMid,
        publicMid: newPublicMid,
        uid: null,
        firstName: data.firstName,
        lastName: data.lastName,
        type: data.type,
        gender: data.gender,
        manager: false,
        email: data.email ?? null,
        phone: data.phone ?? null,
        schoolGrade: data.schoolGrade ?? null,
        birthMonthYear: data.birthMonthYear ?? null,
        birthMonth,
        volunteeringSkills: data.volunteeringSkills ?? [],
        foodAllergies: data.foodAllergies ?? null,
        emergencyContacts: data.emergencyContacts ?? [null, null],
      };

      const memberRef = db.collection('families').doc(fid).collection('members').doc(newMid);
      txn.set(memberRef, { ...memberFields, joinedAt: now });

      // Write a contactKey only when this contact isn't already owned WITHIN the
      // family. A different-fid owner already threw above (theft); a SAME-fid owner
      // (read into emailSnap/phoneSnap) means the new member is REUSING a relative's
      // contact (e.g. the manager's) - share it (the member doc keeps the value)
      // rather than overwriting the key, which would re-point that contact's sign-in
      // from its owner to this new member.
      if (data.email && !(emailSnap && emailSnap.exists)) {
        const hash = hashContactKey('email', data.email);
        txn.set(db.collection('contactKeys').doc(hash), {
          contactKey: hash,
          type: 'email',
          fid,
          mid: newMid,
        });
      }
      if (data.phone && !(phoneSnap && phoneSnap.exists)) {
        const hash = hashContactKey('phone', data.phone);
        txn.set(db.collection('contactKeys').doc(hash), {
          contactKey: hash,
          type: 'phone',
          fid,
          mid: newMid,
        });
      }

      // `joinedAt` is deliberately excluded from the audit payload: it is a
      // serverTimestamp sentinel, not a value, and nesting one inside another
      // document's map field is not something to rely on.
      if (actor) {
        writeAuditLog(txn, db, {
          actorUid: actor.uid,
          actorMid: actor.mid,
          actorRole: actor.role,
          actorExtraRoles: actor.extraRoles,
          action: 'member.create',
          fid,
          mid: newMid,
          before: null,
          after: memberFields,
        });
      }

      return newMid;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('contact-conflict:')) {
      return {
        ok: false,
        status: 409,
        body: { error: 'contact-already-registered', field: msg.split(':')[1] },
      };
    }
    if (msg === 'family-not-found') {
      return { ok: false, status: 404, body: { error: 'family-not-found' } };
    }
    throw err;
  }

  await syncEnrollments(fid, 'POST');

  revalidateTag(`family-${fid}`, 'max');
  return { ok: true, mid };
}

/**
 * Update one member of `fid`.
 *
 * `canSetManagerFlag` is the caller's authority to change `manager` - the route
 * decides it (family managers yes, self-editing members no), this module only
 * enforces it.
 */
export async function updateMember(args: {
  fid: string;
  mid: string;
  body: unknown;
  actor: Actor | null;
  canSetManagerFlag: boolean;
}): Promise<MutateMemberResult> {
  const { fid, mid: targetMid, actor, canSetManagerFlag } = args;

  const parsed = patchMemberSchema.safeParse(args.body);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { error: 'bad-request', issues: parsed.error.issues } };
  }

  const data = parsed.data;

  // A child's birth month/year can't be in the future ('YYYY-MM' sorts lexically).
  if (typeof data.birthMonthYear === 'string' && /^\d{4}-\d{2}$/.test(data.birthMonthYear.trim())) {
    const now = new Date();
    const nowYm = `${now.getUTCFullYear()}-${(now.getUTCMonth() + 1).toString().padStart(2, '0')}`;
    if (data.birthMonthYear.trim() > nowYm) {
      return { ok: false, status: 400, body: { error: 'birthdate-future' } };
    }
  }

  if ('manager' in data && !canSetManagerFlag) {
    return { ok: false, status: 403, body: { error: 'manager-flag-requires-manager-role' } };
  }

  const db = portalFirestore();

  // Captured inside the transaction so a demoted manager's sessions can be
  // revoked AFTER commit (their family-manager claim persists for up to 14 days).
  let demoted = false;
  let demotedEmail: string | null = null;
  let demotedPhone: string | null = null;

  try {
    await db.runTransaction(async (txn) => {
      const familyRef = db.collection('families').doc(fid);
      const memberRef = db.collection('families').doc(fid).collection('members').doc(targetMid);

      const [familySnap, memberSnap] = await Promise.all([
        txn.get(familyRef),
        txn.get(memberRef),
      ]);

      if (!memberSnap.exists) {
        throw Object.assign(new Error('not-found'), { code: 'not-found' });
      }

      const memberData = memberSnap.data() as {
        mid: string;
        type: 'Adult' | 'Child';
        manager: boolean;
        gender: string | null;
        firstName: string | null;
        lastName: string | null;
        email: string | null;
        phone: string | null;
        schoolGrade: string | null;
        birthMonthYear: string | null;
        volunteeringSkills: string[] | null;
        foodAllergies: string | null;
      };

      // Security: ensure member belongs to caller's family by checking document path prefix
      if (!memberData.mid.startsWith(fid + '-')) {
        throw Object.assign(new Error('cross-family'), { code: 'cross-family' });
      }

      // Per-type required-field matrix (owner spec 2026-06-22), enforced via the
      // single shared source of truth against the POST-PATCH member.
      // effectiveType is the patch's `type` when provided, else the existing
      // doc's type.
      const effectiveType: 'Adult' | 'Child' = data.type ?? memberData.type;
      const typeChanged = 'type' in data && data.type !== memberData.type;
      const merged = {
        type: effectiveType,
        gender: 'gender' in data ? data.gender ?? null : memberData.gender,
        firstName: 'firstName' in data ? data.firstName ?? null : memberData.firstName,
        lastName: 'lastName' in data ? data.lastName ?? null : memberData.lastName,
        foodAllergies: 'foodAllergies' in data ? data.foodAllergies ?? null : memberData.foodAllergies,
        email: 'email' in data ? data.email ?? null : memberData.email,
        phone: 'phone' in data ? data.phone ?? null : memberData.phone,
        volunteeringSkills:
          'volunteeringSkills' in data ? data.volunteeringSkills ?? [] : memberData.volunteeringSkills ?? [],
        schoolGrade: 'schoolGrade' in data ? data.schoolGrade ?? null : memberData.schoolGrade,
        birthMonthYear: 'birthMonthYear' in data ? data.birthMonthYear ?? null : memberData.birthMonthYear,
      };
      const missingError = firstMissingRequiredFieldForPatch(merged, data, typeChanged);
      if (missingError) {
        throw Object.assign(new Error(missingError), { code: 'field-required', errorBody: missingError });
      }

      // Guard against demoting the last manager
      if (data.manager === false && memberData.manager === true && familySnap.exists) {
        const familyData = familySnap.data() as { managers: string[] };
        assertNotLastManager(familyData, targetMid, 'demote');
        // Reached only if the demote is allowed - mark it so the demoted
        // member's stale family-manager session is revoked after commit.
        demoted = true;
        demotedEmail = memberData.email;
        demotedPhone = memberData.phone;
      }

      // Before any contactKey writes, verify the new email/phone hash isn't
      // already owned by a different family. Without this, a PATCH could
      // silently overwrite another family's contactKey pointer (theft).
      const newEmail = 'email' in data ? data.email ?? null : null;
      const newPhone = 'phone' in data ? data.phone ?? null : null;
      const newEmailHash = newEmail && newEmail !== memberData.email ? hashContactKey('email', newEmail) : null;
      const newPhoneHash = newPhone && newPhone !== memberData.phone ? hashContactKey('phone', newPhone) : null;
      const [newEmailSnap, newPhoneSnap] = await Promise.all([
        newEmailHash ? txn.get(db.collection('contactKeys').doc(newEmailHash)) : Promise.resolve(null),
        newPhoneHash ? txn.get(db.collection('contactKeys').doc(newPhoneHash)) : Promise.resolve(null),
      ]);
      if (newEmailSnap && newEmailSnap.exists) {
        const existing = newEmailSnap.data() as { fid?: string } | undefined;
        if (existing?.fid && existing.fid !== fid) {
          throw Object.assign(new Error('contact-conflict:email'), { code: 'contact-conflict' });
        }
      }
      if (newPhoneSnap && newPhoneSnap.exists) {
        const existing = newPhoneSnap.data() as { fid?: string } | undefined;
        if (existing?.fid && existing.fid !== fid) {
          throw Object.assign(new Error('contact-conflict:phone'), { code: 'contact-conflict' });
        }
      }

      // Read the CURRENT owner of the member's OLD contact (still in the read
      // phase - Firestore requires all reads before writes). We delete an old
      // contactKey only when THIS member actually owns it: a member that merely
      // SHARED a relative's contact (owner decision #3) must not delete the key
      // out from under its real owner when it changes its own contact.
      const oldEmailHash =
        'email' in data && memberData.email && memberData.email !== newEmail
          ? hashContactKey('email', memberData.email)
          : null;
      const oldPhoneHash =
        'phone' in data && memberData.phone && memberData.phone !== newPhone
          ? hashContactKey('phone', memberData.phone)
          : null;
      const [oldEmailSnap, oldPhoneSnap] = await Promise.all([
        oldEmailHash ? txn.get(db.collection('contactKeys').doc(oldEmailHash)) : Promise.resolve(null),
        oldPhoneHash ? txn.get(db.collection('contactKeys').doc(oldPhoneHash)) : Promise.resolve(null),
      ]);

      // Build update payload - only include fields that were provided
      const updates: Record<string, unknown> = { ...data };

      // birthMonth (1-12) is derived from birthMonthYear on any write that sets
      // it, keeping the two columns in sync without the client computing it.
      if ('birthMonthYear' in data) {
        updates['birthMonth'] = deriveBirthMonth(data.birthMonthYear);
      }

      // Update managers array on family doc if manager flag is changing
      if (familySnap.exists && 'manager' in data) {
        const familyData = familySnap.data() as { managers: string[] };
        let managers = [...(familyData.managers ?? [])];
        if (data.manager === true && !managers.includes(targetMid)) {
          managers.push(targetMid);
        } else if (data.manager === false) {
          managers = managers.filter((m) => m !== targetMid);
        }
        txn.set(familyRef, { managers }, { merge: true });
      }

      // Reconcile contactKeys with ownership awareness (owner decision #3 - the
      // same share-don't-steal rule as registration + the add path):
      //  - delete the OLD key only when this member actually OWNS it
      //    (oldEmailSnap/oldPhoneSnap.mid === targetMid); a shared reuse points at
      //    a relative - leave their key intact;
      //  - write the NEW key only when no one in the family owns it yet
      //    (newEmailSnap/newPhoneSnap absent). A same-fid existing owner means
      //    this member is SHARING that contact - never overwrite the key, which
      //    would re-seat that contact's sign-in onto this member.
      if ('email' in data) {
        if (oldEmailHash && oldEmailSnap && oldEmailSnap.exists) {
          const owner = oldEmailSnap.data() as { mid?: string } | undefined;
          if (owner?.mid === targetMid) {
            txn.delete(db.collection('contactKeys').doc(oldEmailHash));
          }
        }
        if (newEmailHash && !(newEmailSnap && newEmailSnap.exists)) {
          txn.set(db.collection('contactKeys').doc(newEmailHash), {
            contactKey: newEmailHash,
            type: 'email',
            fid,
            mid: targetMid,
          });
        }
      }

      if ('phone' in data) {
        if (oldPhoneHash && oldPhoneSnap && oldPhoneSnap.exists) {
          const owner = oldPhoneSnap.data() as { mid?: string } | undefined;
          if (owner?.mid === targetMid) {
            txn.delete(db.collection('contactKeys').doc(oldPhoneHash));
          }
        }
        if (newPhoneHash && !(newPhoneSnap && newPhoneSnap.exists)) {
          txn.set(db.collection('contactKeys').doc(newPhoneHash), {
            contactKey: newPhoneHash,
            type: 'phone',
            fid,
            mid: targetMid,
          });
        }
      }

      txn.set(memberRef, updates, { merge: true });

      if (actor) {
        writeAuditLog(txn, db, {
          actorUid: actor.uid,
          actorMid: actor.mid,
          actorRole: actor.role,
          actorExtraRoles: actor.extraRoles,
          action: 'member.update',
          fid,
          mid: targetMid,
          before: beforeValues(memberData as unknown as Record<string, unknown>, Object.keys(updates)),
          after: updates,
        });
      }
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'not-found') {
      return { ok: false, status: 404, body: { error: 'not-found' } };
    }
    if (code === 'cross-family') {
      return { ok: false, status: 403, body: { error: 'forbidden' } };
    }
    if (code === 'field-required') {
      // Per-type required 400s share one code path; the specific error string
      // (skills-required / foodAllergies-required / contact-required /
      // grade-required / birthmonth-required) rides on `errorBody`.
      const errorBody = (err as { errorBody?: string }).errorBody ?? 'bad-request';
      return { ok: false, status: 400, body: { error: errorBody } };
    }
    if (code === 'contact-conflict') {
      const msg = err instanceof Error ? err.message : '';
      return {
        ok: false,
        status: 409,
        body: { error: 'contact-already-registered', field: msg.split(':')[1] },
      };
    }
    if (err instanceof LastManagerError) {
      return { ok: false, status: 409, body: { error: 'last-manager' } };
    }
    throw err;
  }

  // A demoted manager keeps their family-manager session claim for up to 14 days.
  // Revoke both of their auth uids' refresh tokens so the demotion takes effect
  // immediately (they re-mint as family-member on next sign-in). Best-effort -
  // the demote already committed; a revoke hiccup must not fail the request.
  if (demoted) {
    try {
      await revokeMemberSessions({ email: demotedEmail, phone: demotedPhone });
    } catch (err) {
      console.error('[members:demote] session revoke failed for', targetMid, err);
    }
  }

  await syncEnrollments(fid, 'mutate');

  revalidateTag(`family-${fid}`, 'max');
  return { ok: true };
}

/** Remove one member of `fid`. */
export async function deleteMember(args: {
  fid: string;
  mid: string;
  actor: Actor | null;
}): Promise<MutateMemberResult> {
  const { fid, mid: targetMid, actor } = args;

  const db = portalFirestore();

  // Captured inside the transaction so the removed member's sessions can be
  // revoked AFTER commit.
  let removedEmail: string | null = null;
  let removedPhone: string | null = null;

  try {
    await db.runTransaction(async (txn) => {
      const familyRef = db.collection('families').doc(fid);
      const memberRef = db.collection('families').doc(fid).collection('members').doc(targetMid);

      const [familySnap, memberSnap] = await Promise.all([
        txn.get(familyRef),
        txn.get(memberRef),
      ]);

      if (!memberSnap.exists) {
        throw Object.assign(new Error('not-found'), { code: 'not-found' });
      }

      const memberData = memberSnap.data() as {
        manager: boolean;
        email: string | null;
        phone: string | null;
      };
      removedEmail = memberData.email;
      removedPhone = memberData.phone;
      const familyData = familySnap.data() as { managers: string[]; fid: string };

      // Guard: cannot remove the last manager (pure check - safe before writes)
      if (memberData.manager) {
        assertNotLastManager(familyData, targetMid, 'remove');
      }

      // Read the member's contactKey docs BEFORE any write (Firestore requires
      // all reads first). We delete a key only when THIS member actually OWNS it
      // (owner.mid === targetMid). A member that merely SHARED a relative's
      // contact (owner decision #3 - e.g. a child on the manager's email) must
      // NOT delete the key out from under its real owner, which would lock that
      // relative out of family lookup + OTP sign-in.
      const emailHash = memberData.email ? hashContactKey('email', memberData.email) : null;
      const phoneHash = memberData.phone ? hashContactKey('phone', memberData.phone) : null;
      const [emailKeySnap, phoneKeySnap] = await Promise.all([
        emailHash ? txn.get(db.collection('contactKeys').doc(emailHash)) : Promise.resolve(null),
        phoneHash ? txn.get(db.collection('contactKeys').doc(phoneHash)) : Promise.resolve(null),
      ]);

      // --- writes below (no reads past this point) ---
      if (emailHash && emailKeySnap && emailKeySnap.exists) {
        const owner = emailKeySnap.data() as { mid?: string } | undefined;
        if (owner?.mid === targetMid) {
          txn.delete(db.collection('contactKeys').doc(emailHash));
        }
      }
      if (phoneHash && phoneKeySnap && phoneKeySnap.exists) {
        const owner = phoneKeySnap.data() as { mid?: string } | undefined;
        if (owner?.mid === targetMid) {
          txn.delete(db.collection('contactKeys').doc(phoneHash));
        }
      }

      // Update managers array on family doc if the deleted member was a manager
      if (memberData.manager && familySnap.exists) {
        const updatedManagers = (familyData.managers ?? []).filter((m) => m !== targetMid);
        txn.set(familyRef, { managers: updatedManagers }, { merge: true });
      }

      txn.delete(memberRef);

      if (actor) {
        writeAuditLog(txn, db, {
          actorUid: actor.uid,
          actorMid: actor.mid,
          actorRole: actor.role,
          actorExtraRoles: actor.extraRoles,
          action: 'member.delete',
          fid,
          mid: targetMid,
          before: memberSnap.data() ?? null,
          after: null,
        });
      }
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'not-found') {
      return { ok: false, status: 404, body: { error: 'not-found' } };
    }
    if (err instanceof LastManagerError) {
      return { ok: false, status: 409, body: { error: 'last-manager' } };
    }
    throw err;
  }

  // Force sign-out for the removed member: their session carries family (and
  // possibly sevak) claims for up to 14 days, and a persisted admin/welcome-team
  // capability would otherwise re-mint into a standalone sevak session on the
  // next sign-in. Strip those caps from both auth uids and revoke their tokens.
  // Best-effort - the delete already committed.
  try {
    await revokeMemberSessions({
      email: removedEmail,
      phone: removedPhone,
      stripCaps: RESURRECTABLE_SEVAK_CAPS,
    });
  } catch (err) {
    console.error('[members:delete] session revoke failed for', targetMid, err);
  }

  await syncEnrollments(fid, 'mutate');

  revalidateTag(`family-${fid}`, 'max');
  return { ok: true };
}
