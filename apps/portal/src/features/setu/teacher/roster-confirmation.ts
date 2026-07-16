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

  // Cheap signals first (no reads): a deliberate enrolledVia, or any attended
  // mid. Whatever is still inconclusive needs the expensive per-family reads.
  const needsRead: LevelEnrollment[] = [];
  for (const enr of enrollments) {
    if (enr.enrolledVia === 'family-initiated' || enr.enrolledVia === 'first-attendance') {
      confirmed.add(enr.fid);
      continue;
    }
    if (enr.enrolledMids.some((mid) => attendedMids.has(mid))) {
      confirmed.add(enr.fid);
      continue;
    }
    needsRead.push(enr);
  }

  // Expensive signal (completed donations) as ONE bulk read, NOT a per-family
  // fan-out. This helper runs on the teacher attendance page load AND every
  // autosave tap, and early in the year the inconclusive set is large (~all
  // promotion carry-forwards), so the old per-family donation read stacked ~N
  // round-trips per save. Read every completed donation once via a collectionGroup
  // and group by fid (status filtered in memory to avoid a collection-group
  // single-field index — same tradeoff as report-dataset.ts). Then only the
  // legacy-payment reads (rare — only when the offering is legacy-sourced) run
  // per-family, in parallel.
  const needsReadFids = new Set(needsRead.map((e) => e.fid));
  const donationsByFid = new Map<string, DonationDoc[]>();
  if (needsRead.length > 0) {
    const donSnap = await db.collectionGroup('donations').get();
    for (const d of donSnap.docs) {
      const data = d.data() as DonationDoc & { status?: unknown };
      if (data.status !== 'completed') continue;
      const fid = d.ref.parent.parent?.id;
      if (!fid || !needsReadFids.has(fid)) continue;
      const arr = donationsByFid.get(fid) ?? [];
      arr.push(data as DonationDoc);
      donationsByFid.set(fid, arr);
    }
  }

  await Promise.all(
    needsRead.map(async (enr) => {
      const donations = donationsByFid.get(enr.fid) ?? [];
      const legacyPaid =
        source === 'legacy' && enr.legacyFid
          ? (await getLegacyPaymentStatus(enr.legacyFid)) === 'paid'
          : false;
      if (isEnrollmentConfirmed({ eid: enr.eid, enrolledVia: enr.enrolledVia }, { attendedCount: 0, donations, legacyPaid })) {
        confirmed.add(enr.fid);
      }
    }),
  );
  return confirmed;
}
