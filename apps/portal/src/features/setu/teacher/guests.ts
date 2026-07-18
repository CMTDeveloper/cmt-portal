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
 * Mark a student present at a level, auto-enrolling their family on first
 * attendance (brief §5 / design §7.5): if the family has no active enrollment for
 * the level's period, enroll them (pins the donation snapshot — suggested, never
 * charged).
 *
 * `isGuest` (default true) controls whether the attendance event is a GUEST mark
 * or a regular roster mark:
 *  - true  → a visiting student (door/walk-in). Shows in the Visitors list; the
 *    enrolled roster's `buildRoster` intentionally SKIPS guest events.
 *  - false → the student is being enrolled AS a roster member (the "Registered ·
 *    not enrolled → mark present" flow). A regular event so it shows Present on
 *    the enrolled roster immediately, not just after the attendance is re-taken.
 */
export async function markGuest(params: {
  levelId: string;
  date: string;
  mid: string;
  status: SetuAttendanceStatus;
  markedByUid: string;
  markedByMid: string | null;
  isGuest?: boolean;
}): Promise<MarkGuestResult> {
  const db = portalFirestore();
  const levelSnap = await db.collection('levels').doc(params.levelId).get();
  if (!levelSnap.exists) return { ok: false, reason: 'level-not-found' };
  const level = levelSnap.data() as LevelDoc;

  const member = await findMemberFid(params.mid);
  if (!member) return { ok: false, reason: 'member-not-found' };

  let autoEnrolled = false;
  if (!(await hasActiveEnrollment(member.fid, level.pid))) {
    // level.pid references the offering id (oid); FirstAttendanceEnrollParams uses oid.
    await enrollFamilyOnFirstAttendance({ fid: member.fid, oid: level.pid, markedByTeacherUid: params.markedByUid });
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
      isGuest: params.isGuest ?? true,
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

export interface DetailedGuest {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  status: SetuAttendanceStatus;
}

/** Guests marked at a level on a date, enriched with each child's name. */
export async function listGuestsDetailed(levelId: string, date: string): Promise<DetailedGuest[]> {
  const db = portalFirestore();
  const snap = await db.collection('attendanceEvents').where('levelId', '==', levelId).where('date', '==', date).get();
  const guests = snap.docs.map((d) => d.data()).filter((e) => e.isGuest === true);
  return Promise.all(
    guests.map(async (e) => {
      let firstName = '';
      let lastName = '';
      try {
        const m = await db.collection('families').doc(e.fid).collection('members').doc(e.mid).get();
        if (m.exists) {
          const md = m.data() as { firstName?: string; lastName?: string };
          firstName = md.firstName ?? '';
          lastName = md.lastName ?? '';
        }
      } catch {
        // tolerate a missing member — show the mid-less row rather than failing the view
      }
      return { mid: e.mid, fid: e.fid, firstName, lastName, status: e.status as SetuAttendanceStatus };
    }),
  );
}
