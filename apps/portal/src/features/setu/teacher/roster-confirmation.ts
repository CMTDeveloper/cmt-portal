import { paymentSourceOf } from '@cmt/shared-domain';
import type { DonationDoc } from '@cmt/shared-domain';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { isEnrollmentConfirmed } from '@/app/family/_helpers/enrollment-confirmation';

export interface LevelEnrollment {
  fid: string;
  eid: string;
  oid: string;
  enrolledVia: 'family-initiated' | 'first-attendance' | 'welcome-team' | 'promotion' | 'kiosk';
  enrolledMids: string[];
  legacyFid: string | null;
}

/**
 * The set of fids whose active enrollment for THIS level's period is
 * engagement-confirmed (issue #23 `isEnrollmentConfirmed`). Scoped to one pid;
 * reads are short-circuited so the per-family donation / legacy reads only fire
 * when the cheaper enrolledVia + attendance signals are inconclusive. Door
 * self-check-ins are intentionally NOT a confirmation signal here (same tradeoff
 * as the reports helper) - a teacher mark resolves it.
 */
export async function deriveConfirmedFidsForLevel(
  db: FirebaseFirestore.Firestore,
  pid: string,
  enrollments: LevelEnrollment[],
): Promise<Set<string>> {
  const confirmed = new Set<string>();
  if (enrollments.length === 0) return confirmed;

  // 1. Attendance (present/late) for the whole period - single-field, auto-indexed.
  const evSnap = await db.collection('attendanceEvents').where('pid', '==', pid).get();
  const attendedMids = new Set<string>();
  for (const d of evSnap.docs) {
    const e = d.data() as { mid?: unknown; status?: unknown };
    if (e.status === 'present' || e.status === 'late') attendedMids.add(String(e.mid ?? ''));
  }

  // 2. Offering payment source (legacy vs portal) - one doc get.
  const offSnap = await db.collection('offerings').doc(pid).get();
  const od = (offSnap.exists ? offSnap.data() : {}) as { paymentSource?: unknown };
  const source = paymentSourceOf(
    od.paymentSource !== undefined ? { paymentSource: od.paymentSource as never } : {},
  );

  for (const enr of enrollments) {
    // Cheap signals first (no reads).
    if (enr.enrolledVia === 'family-initiated' || enr.enrolledVia === 'first-attendance') {
      confirmed.add(enr.fid);
      continue;
    }
    if (enr.enrolledMids.some((mid) => attendedMids.has(mid))) {
      confirmed.add(enr.fid);
      continue;
    }
    // Expensive signals only when still inconclusive.
    const donSnap = await db
      .collection('families')
      .doc(enr.fid)
      .collection('donations')
      .where('status', '==', 'completed')
      .get();
    const donations = donSnap.docs.map((d) => d.data() as DonationDoc);
    const legacyPaid =
      source === 'legacy' && enr.legacyFid
        ? (await getLegacyPaymentStatus(enr.legacyFid)) === 'paid'
        : false;
    if (isEnrollmentConfirmed({ eid: enr.eid, enrolledVia: enr.enrolledVia }, { attendedCount: 0, donations, legacyPaid })) {
      confirmed.add(enr.fid);
    }
  }
  return confirmed;
}
