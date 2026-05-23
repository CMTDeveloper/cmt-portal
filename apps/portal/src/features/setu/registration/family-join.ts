import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from './hash-contact-key';

export interface JoinFamilyInput {
  fid: string;
  contactProof: { type: 'email' | 'phone'; value: string };
}

export interface JoinFamilyResult {
  fid: string;
  mid: string;
  isManager: boolean;
}

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0');
}

export async function joinFamily(input: JoinFamilyInput): Promise<JoinFamilyResult> {
  const db = portalFirestore();
  const { fid, contactProof } = input;
  const hash = hashContactKey(contactProof.type, contactProof.value);

  const result = await db.runTransaction(async (txn) => {
    // 1. Verify the contact key exists
    const contactKeySnap = await txn.get(db.collection('contactKeys').doc(hash));
    if (!contactKeySnap.exists) {
      throw new Error('Contact not found: no matching contact key');
    }
    const contactKeyData = contactKeySnap.data() as { fid: string; mid: string };

    // 2. Verify the contact belongs to this family
    if (contactKeyData.fid !== fid) {
      throw new Error('Contact does not belong to the specified family');
    }

    // 3. Verify the family exists
    const familySnap = await txn.get(db.collection('families').doc(fid));
    if (!familySnap.exists) {
      throw new Error('Family not found: no family document for fid=' + fid);
    }

    // 4. Idempotency — if the contactKey already points to an existing member,
    // return that member rather than creating a duplicate. Without this guard
    // a network retry or double-tap of the Join button orphans the old member
    // doc and rewrites the contactKey pointer to a new one.
    const existingMid = contactKeyData.mid;
    if (existingMid) {
      const existingMemberRef = db
        .collection('families')
        .doc(fid)
        .collection('members')
        .doc(existingMid);
      const existingMemberSnap = await txn.get(existingMemberRef);
      if (existingMemberSnap.exists) {
        const existingData = existingMemberSnap.data() as { manager?: boolean } | undefined;
        return { fid, mid: existingMid, isManager: existingData?.manager === true };
      }
    }

    // 5. Get current member count for seq generation
    const membersSnap = await txn.get(
      db.collection('families').doc(fid).collection('members'),
    );
    const memberCount = (membersSnap as { size: number }).size ?? 0;

    // New joins are always non-manager; a manager can be promoted separately
    const mid = `${fid}-${zeroPad(memberCount + 1)}`;
    const now = FieldValue.serverTimestamp();

    const memberRef = db.collection('families').doc(fid).collection('members').doc(mid);
    txn.set(memberRef, {
      mid,
      uid: null,
      firstName: '',
      lastName: '',
      type: 'Adult',
      gender: 'PreferNotToSay',
      manager: false,
      joinedAt: now,
      email: contactProof.type === 'email' ? contactProof.value : null,
      phone: contactProof.type === 'phone' ? contactProof.value : null,
      schoolGrade: null,
      birthMonthYear: null,
      volunteeringSkills: [],
      foodAllergies: null,
      emergencyContacts: [null, null],
    });

    txn.set(db.collection('contactKeys').doc(hash), {
      contactKey: hash,
      type: contactProof.type,
      fid,
      mid,
    });

    return { fid, mid, isManager: false };
  });

  return result as JoinFamilyResult;
}
