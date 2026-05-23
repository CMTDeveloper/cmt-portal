import { randomBytes } from 'node:crypto';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { findFamilyById } from '@/features/check-in/shared/rtdb/family-lookup';
import { hashContactKey } from './hash-contact-key';

export interface LazyMigrateResult {
  migrated: boolean;
  fid: string;
  legacyFid: string;
}

function generateFid(): string {
  // Crypto randomness to keep FIDs unpredictable. Same generator as register-family.ts.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(12);
  let result = '';
  for (let i = 0; i < 12; i++) {
    const b = bytes[i] ?? 0;
    result += chars[b % chars.length];
  }
  return result;
}

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0');
}

export async function lazyMigrateLegacyFamily(legacyFid: string): Promise<LazyMigrateResult> {
  const legacyFamily = await findFamilyById(legacyFid);
  if (!legacyFamily) {
    throw new Error(`Legacy family not found: fid=${legacyFid}`);
  }

  const db = portalFirestore();

  const result = await db.runTransaction(async (txn) => {
    // Idempotency check: query for an existing Setu family with this legacyFid
    const existingSnap = await txn.get(
      db.collection('families').where('legacyFid', '==', legacyFid).limit(1),
    );

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      if (!existingDoc) throw new Error('Unexpected empty docs array after non-empty check');
      const existingData = existingDoc.data() as { fid: string };
      return { migrated: false, fid: existingData.fid, legacyFid };
    }

    const fid = generateFid();
    const now = FieldValue.serverTimestamp();

    // Derive a manager from the family contacts (use the first contact as the family name source)
    const familyName = legacyFamily.name ?? `Family ${legacyFid}`;
    const searchKeys = [familyName.toLowerCase(), fid, legacyFid];

    const managerMid = `${fid}-01`;

    txn.set(db.collection('families').doc(fid), {
      fid,
      legacyFid,
      name: familyName,
      location: 'Brampton', // default — no location in legacy schema
      createdAt: now,
      managers: [managerMid],
      searchKeys,
    });

    // Create a placeholder manager member from legacy data
    txn.set(db.collection('families').doc(fid).collection('members').doc(managerMid), {
      mid: managerMid,
      uid: null,
      firstName: '',
      lastName: '',
      type: 'Adult',
      gender: 'PreferNotToSay',
      manager: true,
      joinedAt: now,
      email: null,
      phone: null,
      schoolGrade: null,
      birthMonthYear: null,
      volunteeringSkills: [],
      foodAllergies: null,
      emergencyContacts: [null, null],
    });

    // Create members for each legacy student
    let seq = 2;
    for (const student of legacyFamily.students ?? []) {
      const mid = `${fid}-${zeroPad(seq++)}`;
      txn.set(db.collection('families').doc(fid).collection('members').doc(mid), {
        mid,
        uid: null,
        firstName: student.firstName,
        lastName: student.lastName,
        type: 'Child',
        gender: 'PreferNotToSay',
        manager: false,
        joinedAt: now,
        email: null,
        phone: null,
        schoolGrade: student.level ?? null,
        birthMonthYear: null,
        volunteeringSkills: [],
        foodAllergies: null,
        emergencyContacts: [null, null],
      });
    }

    // Create contactKey docs for known contacts
    for (const contact of legacyFamily.contacts ?? []) {
      if (!contact.value) continue;
      const hash = hashContactKey(contact.type, contact.value);
      txn.set(db.collection('contactKeys').doc(hash), {
        contactKey: hash,
        type: contact.type,
        fid,
        mid: managerMid,
      });
    }

    return { migrated: true, fid, legacyFid };
  });

  return result as LazyMigrateResult;
}
