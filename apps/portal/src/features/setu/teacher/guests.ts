import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { attendanceAid, type LevelDoc, type SetuAttendanceStatus } from '@cmt/shared-domain';
import { enrollFamilyOnFirstAttendance } from '@/features/setu/enrollment/enroll-on-first-attendance';

export interface GuestEvent {
  aid: string;
  mid: string;
  fid: string;
  date: string;
  status: SetuAttendanceStatus;
}

/** Find a member by mid across all families → { fid, firstName, lastName }. */
async function findMemberFid(mid: string): Promise<{ fid: string; firstName: string; lastName: string } | null> {
  const snap = await portalFirestore().collectionGroup('members').where('mid', '==', mid).limit(1).get();
  const doc = snap.docs[0];
  if (!doc) return null;
  const d = doc.data();
  return { fid: doc.ref.parent.parent?.id ?? '', firstName: d.firstName, lastName: d.lastName };
}

/** Has this family an active enrollment for the period? (eid is deterministic.) */
async function hasActiveEnrollment(fid: string, pid: string): Promise<boolean> {
  const snap = await portalFirestore().collection('families').doc(fid).collection('enrollments').doc(`${fid}-${pid}`).get();
  return snap.exists && (snap.data()?.status === 'active');
}

export type MarkGuestResult =
  | { ok: true; aid: string; autoEnrolled: boolean }
  | { ok: false; reason: 'level-not-found' | 'member-not-found' };

/**
 * Mark a visiting student present at a level (isGuest:true). This is the
 * documented first-attendance auto-enroll site (brief §5 / design §7.5): if the
 * guest's family has no active enrollment for the level's period, enroll them
 * (pins the donation snapshot — suggested, never charged).
 */
export async function markGuest(params: {
  levelId: string;
  date: string;
  mid: string;
  status: SetuAttendanceStatus;
  markedByUid: string;
  markedByMid: string | null;
}): Promise<MarkGuestResult> {
  const db = portalFirestore();
  const levelSnap = await db.collection('levels').doc(params.levelId).get();
  if (!levelSnap.exists) return { ok: false, reason: 'level-not-found' };
  const level = levelSnap.data() as LevelDoc;

  const member = await findMemberFid(params.mid);
  if (!member) return { ok: false, reason: 'member-not-found' };

  let autoEnrolled = false;
  if (!(await hasActiveEnrollment(member.fid, level.pid))) {
    await enrollFamilyOnFirstAttendance({ fid: member.fid, pid: level.pid, markedByTeacherUid: params.markedByUid });
    autoEnrolled = true;
  }

  const aid = attendanceAid(params.levelId, params.mid, params.date);
  const now = FieldValue.serverTimestamp();
  await db.collection('attendanceEvents').doc(aid).set(
    {
      aid,
      levelId: params.levelId,
      mid: params.mid,
      fid: member.fid,
      pid: level.pid,
      date: params.date,
      status: params.status,
      isGuest: true,
      markedByUid: params.markedByUid,
      markedByMid: params.markedByMid,
      markedAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  return { ok: true, aid, autoEnrolled };
}

/** Guests marked at a level on a date (for the teacher's guest list view). */
export async function listGuests(levelId: string, date: string): Promise<GuestEvent[]> {
  const snap = await portalFirestore()
    .collection('attendanceEvents')
    .where('levelId', '==', levelId)
    .where('date', '==', date)
    .get();
  return snap.docs
    .map((d) => d.data())
    .filter((e) => e.isGuest === true)
    .map((e) => ({ aid: e.aid, mid: e.mid, fid: e.fid, date: e.date, status: e.status }));
}
