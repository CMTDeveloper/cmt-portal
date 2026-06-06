import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { LevelDoc } from '@cmt/shared-domain';
import { markGuest } from './guests';
import { upsertPendingFamilyChild } from './pending-family';

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

/**
 * Add an unregistered child on the spot, keyed by the parent's email
 * (always present here — the visitor flow relaxes that; see addVisitorOnPrompt).
 * Delegates the family/child upsert to the shared pending-family core, then
 * marks the child present as a guest (auto-enrolls for the level's period).
 */
export async function addStudentOnPrompt(params: AddStudentParams): Promise<AddStudentResult> {
  const db = portalFirestore();
  const levelSnap = await db.collection('levels').doc(params.levelId).get();
  if (!levelSnap.exists) return { ok: false, reason: 'level-not-found' };
  const level = levelSnap.data() as LevelDoc;

  const { fid, childMid, createdFamily } = await upsertPendingFamilyChild(db, {
    levelLocation: level.location,
    firstName: params.firstName,
    lastName: params.lastName,
    schoolGrade: params.schoolGrade,
    gender: params.gender,
    parentEmail: params.parentEmail,
    parentPhone: params.parentPhone,
  });

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
