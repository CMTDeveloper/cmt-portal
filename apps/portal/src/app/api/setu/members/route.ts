import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';

export const runtime = 'nodejs';

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
  gender: z.enum(['Male', 'Female', 'PreferNotToSay']),
  email: z.string().email().nullish(),
  phone: z.string().min(7).nullish(),
  schoolGrade: z.string().nullish(),
  birthMonthYear: z.string().nullish(),
  foodAllergies: z.string().nullish(),
  volunteeringSkills: z.array(z.string()).nullish(),
  emergencyContacts: z.tuple([emergencyContactSchema, emergencyContactSchema]).nullish(),
});

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0');
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
  const db = portalFirestore();

  const emailHash = data.email ? hashContactKey('email', data.email) : null;
  const phoneHash = data.phone ? hashContactKey('phone', data.phone) : null;

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

    const memberCount = (membersSnap as { size: number }).size ?? 0;
    const newMid = `${fid}-${zeroPad(memberCount + 1)}`;
    const now = FieldValue.serverTimestamp();

    const memberRef = db.collection('families').doc(fid).collection('members').doc(newMid);
    txn.set(memberRef, {
      mid: newMid,
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
      volunteeringSkills: data.volunteeringSkills ?? [],
      foodAllergies: data.foodAllergies ?? null,
      emergencyContacts: data.emergencyContacts ?? [null, null],
    });

    if (data.email) {
      const hash = hashContactKey('email', data.email);
      txn.set(db.collection('contactKeys').doc(hash), {
        contactKey: hash,
        type: 'email',
        fid,
        mid: newMid,
      });
    }
    if (data.phone) {
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

  revalidateTag(`family-${fid}`, 'max');
  return NextResponse.json({ mid }, { status: 201 });
}
