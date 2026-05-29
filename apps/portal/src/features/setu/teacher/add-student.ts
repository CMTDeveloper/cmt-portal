import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import type { LevelDoc } from '@cmt/shared-domain';
import { generateFid } from '@/features/setu/registration/generate-fid';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { markGuest } from './guests';

export interface AddStudentParams {
  levelId: string;
  date: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
  gender: 'Male' | 'Female' | 'PreferNotToSay';
  parentEmail: string;
  parentPhone: string | null;
  markedByUid: string;
  markedByMid: string | null;
}

export type AddStudentResult =
  | { ok: true; fid: string; childMid: string; createdFamily: boolean; autoEnrolled: boolean }
  | { ok: false; reason: 'level-not-found' };

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
 * Add an unregistered child on the spot. Keyed by the parent's email:
 *  - If that email already claims a family (contactKey exists) → append the
 *    child to it.
 *  - Otherwise → create a new pending family whose MANAGER is the parent (email
 *    contactKey → manager mid), so the parent resolves to family-manager on
 *    their next OTP sign-in (same claim mechanism registerFamily uses — no
 *    invite/co-manager duplication).
 * Then mark the child present as a guest (which auto-enrolls the family for the
 * level's period). The mark is done after the family/child txn commits.
 */
export async function addStudentOnPrompt(params: AddStudentParams): Promise<AddStudentResult> {
  const db = portalFirestore();
  const levelSnap = await db.collection('levels').doc(params.levelId).get();
  if (!levelSnap.exists) return { ok: false, reason: 'level-not-found' };
  const level = levelSnap.data() as LevelDoc;

  const emailHash = hashContactKey('email', params.parentEmail);
  const phoneHash = params.parentPhone ? hashContactKey('phone', params.parentPhone) : null;

  const { fid, childMid, createdFamily } = await db.runTransaction(async (txn) => {
    const existingKey = await txn.get(db.collection('contactKeys').doc(emailHash));
    const now = FieldValue.serverTimestamp();

    if (existingKey.exists) {
      // Parent already has a family — append the child to it.
      const existingFid = (existingKey.data() as { fid: string }).fid;
      const memSnap = await txn.get(db.collection('families').doc(existingFid).collection('members'));
      const nextMid = `${existingFid}-${zeroPad(memSnap.size + 1)}`;
      txn.set(db.collection('families').doc(existingFid).collection('members').doc(nextMid), {
        mid: nextMid,
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

    // New pending family: manager = the parent (claimed by email contactKey).
    const newFid = generateFid();
    const managerMid = `${newFid}-01`;
    const newChildMid = `${newFid}-02`;

    txn.set(db.collection('families').doc(newFid), {
      fid: newFid,
      legacyFid: null,
      name: `${params.lastName} family`,
      location: level.location,
      createdAt: now,
      managers: [managerMid],
      searchKeys: [`${params.lastName} family`.toLowerCase(), newFid],
    });
    // Pending parent (manager) — empty name triggers "complete your profile".
    txn.set(db.collection('families').doc(newFid).collection('members').doc(managerMid), {
      mid: managerMid,
      firstName: '',
      lastName: '',
      type: 'Adult',
      gender: 'PreferNotToSay',
      manager: true,
      email: params.parentEmail.trim().toLowerCase(),
      phone: params.parentPhone,
      schoolGrade: null,
      birthMonthYear: null,
      ...baseMemberFields(now),
    });
    txn.set(db.collection('families').doc(newFid).collection('members').doc(newChildMid), {
      mid: newChildMid,
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
    // contactKeys → manager (the parent), so OTP sign-in resolves them.
    txn.set(db.collection('contactKeys').doc(emailHash), { contactKey: emailHash, type: 'email', fid: newFid, mid: managerMid });
    if (phoneHash) {
      txn.set(db.collection('contactKeys').doc(phoneHash), { contactKey: phoneHash, type: 'phone', fid: newFid, mid: managerMid });
    }
    return { fid: newFid, childMid: newChildMid, createdFamily: true };
  });

  // Mark present as guest (auto-enrolls the family for the level's period).
  const guest = await markGuest({
    levelId: params.levelId,
    date: params.date,
    mid: childMid,
    status: 'present',
    markedByUid: params.markedByUid,
    markedByMid: params.markedByMid,
  });

  return { ok: true, fid, childMid, createdFamily, autoEnrolled: guest.ok ? guest.autoEnrolled : false };
}
