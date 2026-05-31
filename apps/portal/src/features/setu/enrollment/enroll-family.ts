import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { resolveSuggestedAmount, type EnrollmentDoc, type OfferingDoc, type PricingTier } from '@cmt/shared-domain';
import { assertProgramActive } from '@/features/setu/programs/get-programs';

type EnrollVia = EnrollmentDoc['enrolledVia'];

export type EnrollFamilyParams = {
  fid: string;
  oid: string;
  enrolledVia: EnrollVia;
  enrolledByMid: string | null;
};

export type EnrollFamilyResult =
  | { created: true; eid: string; suggestedAmountSnapshot: number }
  | { created: false; eid: string; suggestedAmountSnapshot: number };

/**
 * Idempotent enrollment transaction.
 *
 * - Reads the offering and existing enrollment doc INSIDE the same txn
 *   to guarantee the suggestedAmountSnapshot is pinned to the offering value
 *   at enrollment time (not a stale read from outside the txn).
 * - eid = `{fid}-{oid}` is deterministic — re-enrolling with status='active'
 *   is a no-op that returns created:false.
 * - enrolledMids is derived from members with type='Child' inside the txn
 *   (preserving BV behavior where only children are enrolled).
 *
 * Throws with message 'offering-not-found' | 'offering-disabled' | 'offering-not-yet-open'
 * | 'offering-expired' | 'family-not-found' for caller to translate to HTTP errors.
 */
export async function enrollFamily(params: EnrollFamilyParams): Promise<EnrollFamilyResult> {
  const { fid, oid, enrolledVia, enrolledByMid } = params;
  const db = portalFirestore();
  const eid = `${fid}-${oid}`;

  const result = await db.runTransaction(async (txn) => {
    const offeringRef = db.collection('offerings').doc(oid);
    const enrollmentRef = db
      .collection('families')
      .doc(fid)
      .collection('enrollments')
      .doc(eid);
    const familyRef = db.collection('families').doc(fid);

    const [offeringSnap, enrollmentSnap, familySnap] = await Promise.all([
      txn.get(offeringRef),
      txn.get(enrollmentRef),
      txn.get(familyRef),
    ]);

    if (!familySnap.exists) throw new Error('family-not-found');
    if (!offeringSnap.exists) throw new Error('offering-not-found');

    const offeringData = offeringSnap.data() as Record<string, unknown>;

    function toDate(v: unknown): Date {
      if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
        return (v as { toDate: () => Date }).toDate();
      }
      if (v instanceof Date) return v;
      return new Date(v as string);
    }

    const offering: Pick<
      OfferingDoc,
      | 'enabled'
      | 'startDate'
      | 'endDate'
      | 'pricingTiers'
      | 'programKey'
      | 'programLabel'
      | 'termLabel'
      | 'location'
    > = {
      enabled: offeringData['enabled'] as boolean,
      startDate: toDate(offeringData['startDate']),
      endDate: offeringData['endDate'] != null ? toDate(offeringData['endDate']) : null,
      pricingTiers: offeringData['pricingTiers'] as PricingTier[],
      programKey: offeringData['programKey'] as string,
      programLabel: offeringData['programLabel'] as string,
      termLabel: offeringData['termLabel'] as string,
      location: (offeringData['location'] ?? null) as OfferingDoc['location'],
    };

    // Assert the program is active (not draft/archived). Throws 'program-not-available' if not.
    // Called outside the txn (uses cache) so it's cheap; failure aborts before any writes.
    await assertProgramActive(offering.programKey);

    if (!offering.enabled) throw new Error('offering-disabled');

    const now = new Date();
    // startDate gate removed per spec §5: enabled = enrollment-open (advance registration allowed).
    // Families may enroll before the term starts; the admin's 'enabled' toggle controls enrollment windows.
    if (offering.endDate != null && offering.endDate < now) throw new Error('offering-expired');

    // Suggested amount is prorated by enrollment date (school-year tier schedule),
    // pinned onto the snapshot here so later admin tier edits never change it.
    // Returns 0 for free programs (empty pricingTiers).
    const suggestedAmountSnapshot = resolveSuggestedAmount(offering, now);

    if (enrollmentSnap.exists) {
      const existing = enrollmentSnap.data() as { status: string; suggestedAmountSnapshot: number };
      if (existing.status === 'active') {
        return { created: false as const, eid, suggestedAmountSnapshot: existing.suggestedAmountSnapshot };
      }
    }

    // Read eligible members AFTER early-exit checks so we only pay the cost when actually enrolling.
    // For BV (child program): enroll children. For adult/any programs: enroll all members.
    // This keeps BV behavior identical while supporting future program types.
    const membersSnap = await txn.get(
      db.collection('families').doc(fid).collection('members'),
    );

    const enrolledMids: string[] = [];
    for (const memberDoc of membersSnap.docs) {
      const m = memberDoc.data() as { type?: string; mid?: string };
      // For BV (child eligibility): only enroll Children. Generalised: enroll all.
      // Phase D will thread programKey → eligibility; for now BV = children only.
      if (m.type === 'Child' && m.mid) enrolledMids.push(m.mid);
    }

    txn.set(enrollmentRef, {
      eid,
      fid,
      oid,
      programKey: offering.programKey,
      programLabel: offering.programLabel,
      termLabel: offering.termLabel,
      location: offering.location,
      enrolledAt: FieldValue.serverTimestamp(),
      enrolledVia,
      enrolledByMid,
      enrolledMids,
      suggestedAmountSnapshot,
      suggestedAmountOverride: null,
      status: 'active',
      cancelledAt: null,
      cancelledReason: null,
    });

    return { created: true as const, eid, suggestedAmountSnapshot };
  });

  return result;
}
