import { FieldValue, portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { generateFid } from '@/features/setu/registration/generate-fid';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { allocateFamilyPublicId, allocateMemberPublicIds } from '@/features/setu/ids/public-id-allocator';

// The portal has no direct firebase-admin dep, so we derive the Firestore type
// from the portal handle factory (mirrors check-in-source.ts's pattern).
type Db = ReturnType<typeof portalFirestore>;

export interface PendingChildParams {
  levelLocation: string | null;
  firstName: string;
  lastName: string; // '' allowed
  schoolGrade: string | null;
  gender: 'Male' | 'Female' | 'PreferNotToSay';
  parentEmail: string | null;
  parentPhone: string | null;
}

export interface PendingChildResult {
  fid: string;
  childMid: string;
  createdFamily: boolean;
}

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0');
}

function baseMemberFields(now: FirebaseFirestore.FieldValue) {
  return {
    uid: null,
    volunteeringSkills: [] as string[],
    foodAllergies: null,
    emergencyContacts: [null, null],
    joinedAt: now,
  };
}

/**
 * Ensure a pending family + child member exist for an on-the-spot add, keyed by
 * the parent's contact:
 *  - Look up the family by EMAIL contactKey when an email is given; otherwise by
 *    PHONE contactKey. (Email-first preserves the legacy add-student behavior:
 *    a single contactKey read when an email is present.)
 *  - If found → append the child to that family.
 *  - Else → create a new pending family whose MANAGER is the parent. Write a
 *    contactKey for each contact present (email and/or phone) so the parent
 *    claims the family on their next OTP sign-in. With NO contact at all, the
 *    family is created un-claimable (no contactKey) — contact can be added later.
 * Pure of side effects beyond the Firestore txn; does NOT mark attendance (the
 * caller does that after commit).
 */
export async function upsertPendingFamilyChild(db: Db, params: PendingChildParams): Promise<PendingChildResult> {
  const emailHash = params.parentEmail ? hashContactKey('email', params.parentEmail) : null;
  const phoneHash = params.parentPhone ? hashContactKey('phone', params.parentPhone) : null;

  // Allocate public ids BEFORE the txn opens (the allocator runs its own Firestore
  // transaction; Firestore forbids nested transactions). The branch (append to an
  // existing family vs. create a new one) is only known INSIDE the txn after the
  // contactKey read, so we pre-allocate the new-family worst case: a publicFid +
  // two publicMids (manager + child). The existing-family branch consumes only the
  // first publicMid (the child); the rest is simply unused (counters are cheap
  // monotonic ids — a tiny gap is harmless and never reused).
  const newFamilyPublicFid = await allocateFamilyPublicId();
  const publicMids = await allocateMemberPublicIds(2);

  return db.runTransaction(async (txn) => {
    const now = FieldValue.serverTimestamp();

    // Existing-family lookup: email first, phone only when there's no email.
    let existingFid: string | null = null;
    if (emailHash) {
      const k = await txn.get(db.collection('contactKeys').doc(emailHash));
      if (k.exists) existingFid = (k.data() as { fid: string }).fid;
    } else if (phoneHash) {
      const k = await txn.get(db.collection('contactKeys').doc(phoneHash));
      if (k.exists) existingFid = (k.data() as { fid: string }).fid;
    }

    if (existingFid) {
      const memSnap = await txn.get(db.collection('families').doc(existingFid).collection('members'));
      const nextMid = `${existingFid}-${zeroPad(memSnap.size + 1)}`;
      txn.set(db.collection('families').doc(existingFid).collection('members').doc(nextMid), {
        mid: nextMid,
        publicMid: publicMids[0]!,
        firstName: params.firstName,
        lastName: params.lastName,
        type: 'Child',
        gender: params.gender,
        manager: false,
        email: null,
        phone: null,
        schoolGrade: params.schoolGrade,
        birthMonthYear: null,
        ...baseMemberFields(now),
      });
      return { fid: existingFid, childMid: nextMid, createdFamily: false };
    }

    const newFid = generateFid();
    const managerMid = `${newFid}-01`;
    const newChildMid = `${newFid}-02`;
    const familyName = `${(params.lastName || params.firstName).trim()} family`;

    txn.set(db.collection('families').doc(newFid), {
      fid: newFid,
      publicFid: newFamilyPublicFid,
      legacyFid: null,
      name: familyName,
      location: params.levelLocation,
      createdAt: now,
      managers: [managerMid],
      searchKeys: [familyName.toLowerCase(), newFid],
    });
    txn.set(db.collection('families').doc(newFid).collection('members').doc(managerMid), {
      mid: managerMid,
      publicMid: publicMids[0]!,
      firstName: '',
      lastName: '',
      type: 'Adult',
      gender: 'PreferNotToSay',
      manager: true,
      email: params.parentEmail ? params.parentEmail.trim().toLowerCase() : null,
      phone: params.parentPhone,
      schoolGrade: null,
      birthMonthYear: null,
      ...baseMemberFields(now),
    });
    txn.set(db.collection('families').doc(newFid).collection('members').doc(newChildMid), {
      mid: newChildMid,
      publicMid: publicMids[1]!,
      firstName: params.firstName,
      lastName: params.lastName,
      type: 'Child',
      gender: params.gender,
      manager: false,
      email: null,
      phone: null,
      schoolGrade: params.schoolGrade,
      birthMonthYear: null,
      ...baseMemberFields(now),
    });
    if (emailHash) {
      txn.set(db.collection('contactKeys').doc(emailHash), { contactKey: emailHash, type: 'email', fid: newFid, mid: managerMid });
    }
    if (phoneHash) {
      txn.set(db.collection('contactKeys').doc(phoneHash), { contactKey: phoneHash, type: 'phone', fid: newFid, mid: managerMid });
    }
    return { fid: newFid, childMid: newChildMid, createdFamily: true };
  });
}
