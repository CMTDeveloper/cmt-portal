import 'server-only';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { BALA_VIHAR, attendanceAid, type Location } from '@cmt/shared-domain';
import { getOpenOfferingsForFamily } from '@/features/setu/enrollment/get-open-offerings';
import {
  fetchEnabledLevelsForPid,
  matchChildLevel,
} from '@/features/setu/enrollment/derive-child-level';
import { mostRecentSunday } from '@/features/setu/calendar/calendar';

// markedByUid provenance sentinel for an attendance row created by a door
// check-in (a teacher's mark carries their real uid). markedByMid: null also
// signals "not a teacher". Firestore's status/markedByUid fields require a
// non-empty string, and this doubles as a clear source marker.
export const DOOR_CHECKIN_MARKED_BY = 'door-checkin';

export interface MarkDoorAttendanceResult {
  /** Newly-created present rows. */
  marked: number;
  /** Present children skipped: adult, no matching level, or already marked. */
  skipped: number;
}

/**
 * Best-effort: mark each PRESENT child of a checked-in family present in their
 * Bala Vihar level's attendance for TODAY, so the teacher just verifies who is
 * already marked instead of re-marking everyone (per CMT: the door is the first
 * step; the teacher confirms and handles exceptions).
 *
 * Two guarantees make this safe to run automatically:
 *   - Present-only: it never writes an `absent` row. A child not checked in at
 *     the door stays derived-`unaccounted` (the teacher's "unmarked = absent"),
 *     exactly as today.
 *   - Create-only: it uses `.create()`, so an existing mark (a teacher's, or an
 *     earlier door check-in) is NEVER overwritten - the teacher's explicit mark
 *     always wins.
 *
 * Reuses the SAME open-offering + level match the roster/dashboard/lookup use,
 * so a door-marked child lands in the exact level the teacher sees. The caller
 * wraps this in try/catch: an attendance failure must never fail a check-in that
 * was already recorded.
 */
export async function markDoorAttendance(params: {
  fid: string;
  location: Location | null;
  /** mids the sevak left checked (present) at the door. */
  presentMids: string[];
  now?: Date;
}): Promise<MarkDoorAttendanceResult> {
  const { fid, location, presentMids } = params;
  const now = params.now ?? new Date();
  if (presentMids.length === 0) return { marked: 0, skipped: 0 };

  const offerings = await getOpenOfferingsForFamily(BALA_VIHAR, location);
  const oid = offerings[0]?.oid;
  // No open Bala Vihar offering (off-season) → nothing to mark class attendance against.
  if (!oid) return { marked: 0, skipped: presentMids.length };

  const levels = await fetchEnabledLevelsForPid(oid);
  // The class day the teacher's attendance page shows — its default date is
  // mostRecentSunday(), NOT the raw calendar day. Marking torontoToday() lands on
  // (e.g.) a Monday the teacher can never view, so the mark is invisible. Use the
  // SAME class-day function so a door-marked row appears on the teacher's page.
  const date = mostRecentSunday(now);
  const db = portalFirestore();

  // Read the members once to get each present child's type + grade for the match.
  const membersSnap = await db.collection('families').doc(fid).collection('members').get();
  const byMid = new Map(
    membersSnap.docs.map((d) => {
      const data = d.data();
      return [
        String(data.mid),
        {
          type: (data.type ?? 'Child') as 'Adult' | 'Child',
          schoolGrade: (data.schoolGrade ?? null) as string | null,
          birthMonthYear: (data.birthMonthYear ?? null) as string | null,
        },
      ] as const;
    }),
  );

  let marked = 0;
  let skipped = 0;
  for (const mid of presentMids) {
    const m = byMid.get(mid);
    // Only children who match an enabled level get a class-attendance mark.
    if (!m || m.type === 'Adult') {
      skipped++;
      continue;
    }
    const matched = matchChildLevel(
      { type: m.type, schoolGrade: m.schoolGrade, birthMonthYear: m.birthMonthYear },
      levels,
      now,
    );
    if (!matched) {
      skipped++;
      continue;
    }

    const aid = attendanceAid(matched.levelId, mid, date);
    try {
      // create() (not set/merge) so an existing mark is never overwritten.
      await db.collection('attendanceEvents').doc(aid).create({
        aid,
        levelId: matched.levelId,
        mid,
        fid,
        pid: oid,
        date,
        status: 'present',
        isGuest: false,
        markedByUid: DOOR_CHECKIN_MARKED_BY,
        markedByMid: null,
        markedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      marked++;
    } catch (e) {
      // ALREADY_EXISTS (gRPC code 6): a teacher or an earlier door check-in
      // already marked this student today - respect it. Re-throw anything else
      // for the best-effort caller to swallow.
      if ((e as { code?: number }).code === 6) {
        skipped++;
        continue;
      }
      throw e;
    }
  }

  return { marked, skipped };
}
