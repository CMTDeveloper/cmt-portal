import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import type { EnrollmentDoc, DonationPeriodDoc } from '@cmt/shared-domain';

type EnrollVia = EnrollmentDoc['enrolledVia'];

export type EnrollFamilyParams = {
  fid: string;
  pid: string;
  enrolledVia: EnrollVia;
  enrolledByMid: string | null;
};

export type EnrollFamilyResult =
  | { created: true; eid: string; suggestedAmountSnapshot: number }
  | { created: false; eid: string; suggestedAmountSnapshot: number };

/**
 * Idempotent enrollment transaction.
 *
 * - Reads the donationPeriod and existing enrollment doc INSIDE the same txn
 *   to guarantee the suggestedAmountSnapshot is pinned to the period value
 *   at enrollment time (not a stale read from outside the txn).
 * - eid = `{fid}-{pid}` is deterministic — re-enrolling with status='active'
 *   is a no-op that returns created:false.
 * - childrenMids is derived from members with type='Child' inside the txn.
 *
 * Throws with message 'period-not-found' | 'period-disabled' | 'period-not-yet-open'
 * | 'period-expired' | 'family-not-found' for caller to translate to HTTP errors.
 */
export async function enrollFamily(params: EnrollFamilyParams): Promise<EnrollFamilyResult> {
  const { fid, pid, enrolledVia, enrolledByMid } = params;
  const db = portalFirestore();
  const eid = `${fid}-${pid}`;

  const result = await db.runTransaction(async (txn) => {
    const periodRef = db.collection('donationPeriods').doc(pid);
    const enrollmentRef = db
      .collection('families')
      .doc(fid)
      .collection('enrollments')
      .doc(eid);
    const familyRef = db.collection('families').doc(fid);

    const [periodSnap, enrollmentSnap, familySnap] = await Promise.all([
      txn.get(periodRef),
      txn.get(enrollmentRef),
      txn.get(familyRef),
    ]);

    if (!familySnap.exists) throw new Error('family-not-found');
    if (!periodSnap.exists) throw new Error('period-not-found');

    const periodData = periodSnap.data() as Record<string, unknown>;

    function toDate(v: unknown): Date {
      if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
        return (v as { toDate: () => Date }).toDate();
      }
      if (v instanceof Date) return v;
      return new Date(v as string);
    }

    const period: Pick<DonationPeriodDoc, 'enabled' | 'startDate' | 'endDate' | 'suggestedAmount' | 'programLabel' | 'periodLabel' | 'location'> = {
      enabled: periodData['enabled'] as boolean,
      startDate: toDate(periodData['startDate']),
      endDate: toDate(periodData['endDate']),
      suggestedAmount: periodData['suggestedAmount'] as number,
      programLabel: periodData['programLabel'] as string,
      periodLabel: periodData['periodLabel'] as string,
      location: periodData['location'] as DonationPeriodDoc['location'],
    };

    if (!period.enabled) throw new Error('period-disabled');

    const now = new Date();
    if (period.startDate > now) throw new Error('period-not-yet-open');
    if (period.endDate < now) throw new Error('period-expired');

    if (enrollmentSnap.exists) {
      const existing = enrollmentSnap.data() as { status: string; suggestedAmountSnapshot: number };
      if (existing.status === 'active') {
        return { created: false as const, eid, suggestedAmountSnapshot: existing.suggestedAmountSnapshot };
      }
    }

    // Read children AFTER early-exit checks so we only pay the cost when actually enrolling
    const membersSnap = await txn.get(
      db.collection('families').doc(fid).collection('members'),
    );

    const childrenMids: string[] = [];
    for (const memberDoc of membersSnap.docs) {
      const m = memberDoc.data() as { type?: string; mid?: string };
      if (m.type === 'Child' && m.mid) childrenMids.push(m.mid);
    }

    txn.set(enrollmentRef, {
      eid,
      fid,
      pid,
      programLabel: period.programLabel,
      periodLabel: period.periodLabel,
      location: period.location,
      enrolledAt: FieldValue.serverTimestamp(),
      enrolledVia,
      enrolledByMid,
      childrenMids,
      suggestedAmountSnapshot: period.suggestedAmount,
      suggestedAmountOverride: null,
      status: 'active',
      cancelledAt: null,
      cancelledReason: null,
    });

    return { created: true as const, eid, suggestedAmountSnapshot: period.suggestedAmount };
  });

  return result;
}
