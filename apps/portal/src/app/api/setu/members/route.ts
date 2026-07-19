import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { allocateMemberPublicIds } from '@/features/setu/ids/public-id-allocator';
import { nextMemberMid } from '@/features/setu/ids/member-mid';
import { syncActiveEnrollmentMemberships } from '@/features/setu/enrollment/sync-enrollment-members';
import { whatsMissingForMember, type MemberRequiredField } from '@cmt/shared-domain';


// Emergency contact: only `relation` is required to be non-empty when the
// object is present. Phone and email are independently optional (you may have
// one, both, or neither — Bala Vihar families often have a relation name we
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
const addMemberSchema = z.object({
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


// Maps a missing required field (from the shared matrix) to the 400 error code
// the write routes return. Adult email/phone collapse to one `contact-required`.
// `volunteeringSkills` reuses the pre-existing `skills-required` code.
const REQUIRED_FIELD_ERROR: Record<MemberRequiredField, string> = {
  firstName: 'bad-request',
  lastName: 'bad-request',
  gender: 'bad-request',
  type: 'bad-request',
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
 * Picks the first unsatisfied required field (in REQUIRED_FIELD_ORDER) out of a
 * set of missing fields and returns its 400 error code, or null if none of the
 * enforced fields are missing. firstName/lastName/gender/type are already
 * enforced by the zod schema, so they never reach here.
 */
function requiredFieldError(missing: MemberRequiredField[]): string | null {
  const missingSet = new Set(missing);
  for (const field of REQUIRED_FIELD_ORDER) {
    if (missingSet.has(field)) {
      return REQUIRED_FIELD_ERROR[field];
    }
  }
  return null;
}

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  const fid = req.headers.get('x-portal-fid');

  if (!role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (role !== 'family-manager') {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = addMemberSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // Per-type required-field matrix (owner spec 2026-06-22), enforced via the
  // single shared source of truth. `whatsMissingForMember` selects the matrix
  // by `data.type` (always present on POST) and reports every unsatisfied
  // required field; we surface the first as a clear 400. This covers the
  // pre-existing adult skills-required guard (issue #10) plus foodAllergies
  // (all), adult email/phone (contact-required), and child grade/birthMonthYear.
  const missing = whatsMissingForMember({
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
  const missingError = requiredFieldError(missing);
  if (missingError) {
    return NextResponse.json({ error: missingError }, { status: 400 });
  }

  // A child's birth month/year can't be in the future.
  if (isFutureBirthMonthYear(data.birthMonthYear)) {
    return NextResponse.json({ error: 'birthdate-future' }, { status: 400 });
  }

  // birthMonth (1-12) is derived from birthMonthYear ('YYYY-MM') on every write
  // that sets it, so the client never has to keep the two in sync. An explicit
  // body.birthMonth is honoured only when birthMonthYear is absent.
  const birthMonth = deriveBirthMonth(data.birthMonthYear) ?? data.birthMonth ?? null;

  const db = portalFirestore();

  const emailHash = data.email ? hashContactKey('email', data.email) : null;
  const phoneHash = data.phone ? hashContactKey('phone', data.phone) : null;

  // Allocate the new member's user-facing 5-digit publicMid BEFORE the txn opens —
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

    const memberRef = db.collection('families').doc(fid).collection('members').doc(newMid);
    txn.set(memberRef, {
      mid: newMid,
      publicMid: newPublicMid,
      uid: null,
      firstName: data.firstName,
      lastName: data.lastName,
      type: data.type,
      gender: data.gender,
      manager: false,
      joinedAt: now,
      email: data.email ?? null,
      phone: data.phone ?? null,
      schoolGrade: data.schoolGrade ?? null,
      birthMonthYear: data.birthMonthYear ?? null,
      birthMonth,
      volunteeringSkills: data.volunteeringSkills ?? [],
      foodAllergies: data.foodAllergies ?? null,
      emergencyContacts: data.emergencyContacts ?? [null, null],
    });

    // Write a contactKey only when this contact isn't already owned WITHIN the
    // family. A different-fid owner already threw above (theft); a SAME-fid owner
    // (read into emailSnap/phoneSnap) means the new member is REUSING a relative's
    // contact (e.g. the manager's) — share it (the member doc keeps the value)
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

    return newMid;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('contact-conflict:')) {
      return NextResponse.json(
        { error: 'contact-already-registered', field: msg.split(':')[1] },
        { status: 409 },
      );
    }
    if (msg === 'family-not-found') {
      return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
    }
    throw err;
  }

  // Keep the family's active-enrollment rosters in sync: a child added AFTER the
  // family enrolled must join the enrollment (enrolledMids), else the dashboard/
  // roster/attendance silently omit them (the N=2 bug). Best-effort — the member
  // is already saved, so a sync hiccup must not 500 the add; the next member
  // change (or the retro-sweep) reconciles.
  try {
    await syncActiveEnrollmentMemberships(fid);
  } catch (err) {
    console.error('[members:POST] enrollment membership sync failed for', fid, err);
  }

  revalidateTag(`family-${fid}`, 'max');
  return NextResponse.json({ mid }, { status: 201 });
}
