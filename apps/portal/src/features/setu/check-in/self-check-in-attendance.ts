import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { resolveKioskFamily } from './resolve-kiosk-family';
import { autoEnrollBalaVihar } from './auto-enroll-bala-vihar';
import { markDoorAttendance } from './mark-door-attendance';

/**
 * Best-effort bridge: a family self-check-in (legacy family flow) → Setu class
 * attendance, so a self-checked-in child shows present to the teacher, exactly
 * like the door kiosk (CMT decision 2026-07-20).
 *
 * The self-check-in works in LEGACY ids (legacy family id + legacy sids). This
 * resolves the Setu family by its `legacyFid`, maps the present legacy sids to
 * Setu member mids (via each member's `legacySid`), auto-enrolls (idempotent, so
 * the child lands on the level roster), then marks each present child present in
 * their Bala Vihar class attendance for the class day. A family not in Setu
 * (unmigrated) is a no-op. NEVER throws — the caller's check-in is already
 * recorded and must not fail on this side effect.
 */
export async function markSelfCheckInAttendance(params: {
  legacyFamilyId: string;
  presentLegacySids: string[];
}): Promise<{ marked: number }> {
  const { legacyFamilyId, presentLegacySids } = params;
  if (presentLegacySids.length === 0) return { marked: 0 };

  try {
    const setu = await resolveKioskFamily(legacyFamilyId);
    if (!setu) return { marked: 0 }; // not migrated into Setu — nothing to mark against

    const wanted = new Set(presentLegacySids.map(String));
    const membersSnap = await portalFirestore()
      .collection('families')
      .doc(setu.fid)
      .collection('members')
      .get();
    const presentMids = membersSnap.docs
      .map((d) => d.data())
      .filter((m) => m['legacySid'] != null && wanted.has(String(m['legacySid'])))
      .map((m) => String(m['mid']));
    if (presentMids.length === 0) return { marked: 0 };

    // Auto-enroll (idempotent) so the child is on the level roster; its result is
    // irrelevant here, so swallow failures and continue to the attendance mark.
    await autoEnrollBalaVihar({ fid: setu.fid, location: setu.location }).catch((e) =>
      console.error('[self-check-in] auto-enroll failed (continuing)', e),
    );
    const res = await markDoorAttendance({ fid: setu.fid, location: setu.location, presentMids });
    return { marked: res.marked };
  } catch (e) {
    console.error('[self-check-in] setu attendance failed (check-in already recorded)', e);
    return { marked: 0 };
  }
}
