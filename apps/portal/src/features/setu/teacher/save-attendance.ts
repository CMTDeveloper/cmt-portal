import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { attendanceAid, type SetuAttendanceStatus } from '@cmt/shared-domain';
import { deriveRoster } from './roster';

export interface SaveAttendanceParams {
  levelId: string;
  date: string;
  marks: Record<string, SetuAttendanceStatus>;
  markedByUid: string;
  markedByMid: string | null;
  now?: Date;
}

export type SaveAttendanceResult =
  | { ok: true; saved: number; skipped: string[] }
  | { ok: false; reason: 'level-not-found' };

/**
 * Idempotent batched upsert of attendance marks for a level + date. The roster
 * is enrollment-gated (§6), so marks are validated against it: marks for mids
 * NOT on the roster are skipped (guests/add-student go through the dedicated
 * guest flow in 4e, which is where first-attendance auto-enroll fires —
 * roster members are already enrolled by construction). Composite aid means
 * re-marking the same student overwrites, never duplicates.
 */
export async function saveAttendance(params: SaveAttendanceParams): Promise<SaveAttendanceResult> {
  const { levelId, date, marks, markedByUid, markedByMid } = params;
  const roster = await deriveRoster(levelId, date, params.now);
  if (!roster) return { ok: false, reason: 'level-not-found' };

  const fidByMid = new Map(roster.members.map((m) => [m.mid, m.fid]));

  const db = portalFirestore();
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();
  const skipped: string[] = [];
  let saved = 0;

  for (const [mid, status] of Object.entries(marks)) {
    const fid = fidByMid.get(mid);
    if (!fid) {
      skipped.push(mid); // not on this level's roster — ignore (guest flow handles these)
      continue;
    }
    const aid = attendanceAid(levelId, mid, date);
    batch.set(
      db.collection('attendanceEvents').doc(aid),
      {
        aid,
        levelId,
        mid,
        fid,
        pid: roster.pid,
        date,
        status,
        isGuest: false,
        markedByUid,
        markedByMid,
        markedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    saved++;
  }

  await batch.commit();
  return { ok: true, saved, skipped };
}
