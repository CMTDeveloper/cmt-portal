import { paymentSourceOf } from '@cmt/shared-domain';
import type { DonationDoc } from '@cmt/shared-domain';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { isEnrollmentConfirmed } from '@/app/family/_helpers/enrollment-confirmation';
import { loadActivePledgeFids } from '@/features/setu/pledges/active-pledge-fids';

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
  // A live monthly pledge IS the enrollment donation (2026-07-27), so it
  // confirms exactly as a completed one-time donation does. ONE query for every
  // pledging family, in the same bulk spirit as the donation read below - this
  // helper runs on every autosave tap, so a per-family lookup here would be the
  // fan-out that read was written to remove.
  const pledgedFids = await loadActivePledgeFids();

  const needsReadFids = new Set(needsRead.map((e) => e.fid));
  const donationsByFid = new Map<string, DonationDoc[]>();
  if (needsRead.length > 0) {
    const donSnap = await db.collectionGroup('donations').get();
    for (const d of donSnap.docs) {
      const data = d.data() as DonationDoc & { status?: unknown; fid?: unknown };
      if (data.status !== 'completed') continue;
      // `donations` is a TOP-LEVEL collection with an `fid` field
      // (create-donation.ts:28), so d.ref.parent.parent is null for every real
      // doc. Prefer the field; keep the parent-path fallback for any legacy
      // subcollection doc. Same pattern as enrollment-report.ts:178,
      // report-dataset.ts:111 and build-csv-rows.ts:78.
      const fid = typeof data.fid === 'string' ? data.fid : d.ref.parent.parent?.id;
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
      if (
        isEnrollmentConfirmed(
          { eid: enr.eid, enrolledVia: enr.enrolledVia },
          { attendedCount: 0, donations, legacyPaid, hasActivePledge: pledgedFids.has(enr.fid) },
        )
      ) {
        confirmed.add(enr.fid);
      }
    }),
  );
  return confirmed;
}
