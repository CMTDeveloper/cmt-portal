import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { attendanceAid } from '@cmt/shared-domain';
import { ensurePublicFid } from '@/features/setu/enrollment/ensure-public-fid';
import { deriveRoster } from './roster';

export interface ConfirmPreviousParams {
  levelId: string; mid: string; date: string; markedByUid: string; markedByMid: string | null; now?: Date;
}
export type ConfirmPreviousResult =
  | { ok: true; fid: string }
  | { ok: false; reason: 'level-not-found' | 'not-a-previous-student' };

/**
 * Mark ONE previous (unconfirmed carry-forward) student present. Writes a single
 * `present` attendance event - which confirms the family's already-active
 * enrollment via the `attendedCount > 0` rule, so the student + siblings surface
 * in their Enrolled lists on the next load. No enrollment doc is created/mutated,
 * and no absent sweep runs (unlike the main roster save).
 */
export async function confirmPreviousStudent(params: ConfirmPreviousParams): Promise<ConfirmPreviousResult> {
  const { levelId, mid, date, markedByUid, markedByMid } = params;
  // MUST pass withConfirmation:true so previousStudents is populated.
  const roster = await deriveRoster(levelId, date, params.now, { withConfirmation: true });
  if (!roster) return { ok: false, reason: 'level-not-found' };

  const row = roster.previousStudents.find((m) => m.mid === mid);
  if (!row) return { ok: false, reason: 'not-a-previous-student' };

  const db = portalFirestore();
  const now = FieldValue.serverTimestamp();
  const aid = attendanceAid(levelId, mid, date);
  const batch = db.batch();
  batch.set(
    db.collection('attendanceEvents').doc(aid),
    { aid, levelId, mid, fid: row.fid, pid: roster.pid, date, status: 'present', isGuest: false, markedByUid, markedByMid, markedAt: now, updatedAt: now },
    { merge: true },
  );
  await batch.commit();

  // Confirming a carry-forward family is an engagement event under Model Y2: the
  // family's active (rollover) enrollment did not go through enrollFamily, so mint
  // its user-facing publicFid now if it lacks one - otherwise a re-engaged
  // returning family would show "Enrolled" with no Family ID. Idempotent + best-
  // effort (the attendance write already committed).
  try {
    await ensurePublicFid(row.fid);
  } catch (e) {
    console.error('[confirmPreviousStudent] publicFid mint failed (attendance already committed)', e);
  }

  return { ok: true, fid: row.fid };
}
