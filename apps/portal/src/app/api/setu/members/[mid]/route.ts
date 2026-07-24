import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { assertNotLastManager, LastManagerError } from '@/features/setu/members';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { syncActiveEnrollmentMemberships } from '@/features/setu/enrollment/sync-enrollment-members';
import { revokeMemberSessions, RESURRECTABLE_SEVAK_CAPS } from '@/features/setu/auth/revoke-sessions';
import { whatsMissingForMember, type MemberRequiredField } from '@cmt/shared-domain';


type RouteContext = { params: Promise<{ mid: string }> };

// Immutable fields — cannot be patched by anyone
const patchSchema = z
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

// Maps a missing required field (from the shared matrix) to the 400 error code.
// Adult email/phone collapse to `contact-required`; volunteeringSkills reuses
// the pre-existing `skills-required`. firstName/lastName/gender/type are already
// enforced by the zod schema, so they resolve to null here (never the cause of
// a per-type 400 on PATCH).
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

// Deterministic order so the surfaced 400 is stable when several fields are missing.
const REQUIRED_FIELD_ORDER: MemberRequiredField[] = [
  'foodAllergies',
  'volunteeringSkills',
  'email',
  'phone',
  'schoolGrade',
  'birthMonthYear',
];

function requiredFieldErrorPatch(missing: MemberRequiredField[]): string | null {
  const missingSet = new Set(missing);
  for (const field of REQUIRED_FIELD_ORDER) {
    if (missingSet.has(field)) {
      return REQUIRED_FIELD_ERROR[field];
    }
  }
  return null;
}

// 'YYYY-MM' -> month number (1-12), or null if unparseable/absent.
function deriveBirthMonth(birthMonthYear: string | null | undefined): number | null {
  if (typeof birthMonthYear !== 'string') return null;
  const m = /^\d{4}-(\d{2})$/.exec(birthMonthYear.trim());
  if (!m) return null;
  const month = Number(m[1]);
  return month >= 1 && month <= 12 ? month : null;
}

export async function PATCH(req: Request, ctx: RouteContext) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  const fid = req.headers.get('x-portal-fid');
  const callerMid = req.headers.get('x-portal-mid');
  const { mid: targetMid } = await ctx.params;

  if (!role || !callerMid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

  const isManager = role === 'family-manager';
  const isSelfEdit = callerMid === targetMid;

  // Non-managers can only edit themselves
  if (!isManager && !isSelfEdit) {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // A child's birth month/year can't be in the future ('YYYY-MM' sorts lexically).
  if (typeof data.birthMonthYear === 'string' && /^\d{4}-\d{2}$/.test(data.birthMonthYear.trim())) {
    const now = new Date();
    const nowYm = `${now.getUTCFullYear()}-${(now.getUTCMonth() + 1).toString().padStart(2, '0')}`;
    if (data.birthMonthYear.trim() > nowYm) {
      return NextResponse.json({ error: 'birthdate-future' }, { status: 400 });
    }
  }

  // Only managers can change manager flag
  if ('manager' in data && !isManager) {
    return NextResponse.json({ error: 'manager-flag-requires-manager-role' }, { status: 403 });
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
      // single shared source of truth against the POST-PATCH member. effectiveType
      // is the patch's `type` when provided, else the existing doc's type. A rule
      // is enforced only when the field is "in scope": the patch touches that
      // field, OR the patch flips `type` (which re-evaluates every required field
      // for the new type). A partial patch that doesn't touch a still-missing
      // field is therefore NOT blocked — legacy-incomplete docs stay editable.
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
      const missing = whatsMissingForMember(merged).filter(
        (field) => typeChanged || field in data,
      );
      const missingError = requiredFieldErrorPatch(missing);
      if (missingError) {
        throw Object.assign(new Error(missingError), { code: 'field-required', errorBody: missingError });
      }

      // Guard against demoting the last manager
      if (data.manager === false && memberData.manager === true && familySnap.exists) {
        const familyData = familySnap.data() as { managers: string[] };
        assertNotLastManager(familyData, targetMid, 'demote');
        // Reached only if the demote is allowed — mark it so the demoted
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
      // phase — Firestore requires all reads before writes). We delete an old
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

      // Build update payload — only include fields that were provided
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

      // Reconcile contactKeys with ownership awareness (owner decision #3 — the
      // same share-don't-steal rule as registration + the POST route):
      //  - delete the OLD key only when this member actually OWNS it
      //    (oldEmailSnap/oldPhoneSnap.mid === targetMid); a shared reuse points at
      //    a relative — leave their key intact;
      //  - write the NEW key only when no one in the family owns it yet
      //    (newEmailSnap/newPhoneSnap absent). A same-fid existing owner means
      //    this member is SHARING that contact — never overwrite the key, which
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
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'not-found') {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    if (code === 'cross-family') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (code === 'field-required') {
      // Per-type required 400s share one code path; the specific error string
      // (skills-required / foodAllergies-required / contact-required /
      // grade-required / birthmonth-required) rides on `errorBody`.
      const errorBody = (err as { errorBody?: string }).errorBody ?? 'bad-request';
      return NextResponse.json({ error: errorBody }, { status: 400 });
    }
    if (code === 'contact-conflict') {
      const msg = err instanceof Error ? err.message : '';
      return NextResponse.json(
        { error: 'contact-already-registered', field: msg.split(':')[1] },
        { status: 409 },
      );
    }
    if (err instanceof LastManagerError) {
      return NextResponse.json({ error: 'last-manager' }, { status: 409 });
    }
    throw err;
  }

  // A demoted manager keeps their family-manager session claim for up to 14 days.
  // Revoke both of their auth uids' refresh tokens so the demotion takes effect
  // immediately (they re-mint as family-member on next sign-in). Best-effort —
  // the demote already committed; a revoke hiccup must not 500 the request.
  if (demoted) {
    try {
      await revokeMemberSessions({ email: demotedEmail, phone: demotedPhone });
    } catch (err) {
      console.error('[members:demote] session revoke failed for', targetMid, err);
    }
  }

  // A member edit/removal can change eligibility (a child edited to Adult, or a
  // child deleted), so reconcile the family's active-enrollment rosters
  // (enrolledMids). Best-effort — the member write already committed; a sync
  // hiccup must not 500 the request. The next member change re-reconciles.
  try {
    await syncActiveEnrollmentMemberships(fid);
  } catch (err) {
    console.error('[members:mutate] enrollment membership sync failed for', fid, err);
  }

  revalidateTag(`family-${fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = _req.headers.get('x-portal-role');
  const fid = _req.headers.get('x-portal-fid');
  const { mid: targetMid } = await ctx.params;

  if (!role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (role !== 'family-manager') {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

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

      // Guard: cannot remove the last manager (pure check — safe before writes)
      if (memberData.manager) {
        assertNotLastManager(familyData, targetMid, 'remove');
      }

      // Read the member's contactKey docs BEFORE any write (Firestore requires
      // all reads first). We delete a key only when THIS member actually OWNS it
      // (owner.mid === targetMid). A member that merely SHARED a relative's
      // contact (owner decision #3 — e.g. a child on the manager's email) must
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
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'not-found') {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    if (err instanceof LastManagerError) {
      return NextResponse.json({ error: 'last-manager' }, { status: 409 });
    }
    throw err;
  }

  // Force sign-out for the removed member: their session carries family (and
  // possibly sevak) claims for up to 14 days, and a persisted admin/welcome-team
  // capability would otherwise re-mint into a standalone sevak session on the
  // next sign-in. Strip those caps from both auth uids and revoke their tokens.
  // Best-effort — the delete already committed.
  try {
    await revokeMemberSessions({
      email: removedEmail,
      phone: removedPhone,
      stripCaps: RESURRECTABLE_SEVAK_CAPS,
    });
  } catch (err) {
    console.error('[members:delete] session revoke failed for', targetMid, err);
  }

  // A member edit/removal can change eligibility (a child edited to Adult, or a
  // child deleted), so reconcile the family's active-enrollment rosters
  // (enrolledMids). Best-effort — the member write already committed; a sync
  // hiccup must not 500 the request. The next member change re-reconciles.
  try {
    await syncActiveEnrollmentMemberships(fid);
  } catch (err) {
    console.error('[members:mutate] enrollment membership sync failed for', fid, err);
  }

  revalidateTag(`family-${fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
