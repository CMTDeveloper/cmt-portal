import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { memberEligibleForProgram, resolveSuggestedAmount, type EnrollmentDoc, type OfferingDoc, type PricingTier } from '@cmt/shared-domain';
import { getProgram } from '@/features/setu/programs/get-programs';
import { allocateFamilyPublicId } from '@/features/setu/ids/public-id-allocator';

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
 * - enrolledMids is derived from members that pass the program's eligibility
 *   (memberEligibleForProgram) inside the txn — BV (child) → children, while
 *   'any'/'adult' programs enroll all matching members.
 *
 * Throws with message 'offering-not-found' | 'offering-disabled' | 'offering-expired'
 * | 'family-not-found' | 'program-not-available' | 'no-eligible-members' for caller
 * to translate to HTTP errors.
 */
export async function enrollFamily(params: EnrollFamilyParams): Promise<EnrollFamilyResult> {
  const { fid, oid, enrolledVia, enrolledByMid } = params;
  const db = portalFirestore();
  const eid = `${fid}-${oid}`;
  const familyRef = db.collection('families').doc(fid);

  // Lazy publicFid mint: the user-facing Family ID is assigned at a family's
  // FIRST enrollment, not at family creation (registration / legacy-migration /
  // teacher-add all leave it unset). The allocator opens its OWN Firestore
  // transaction and Firestore forbids nested transactions, so pre-read the
  // family here and pre-allocate ONLY when it has no publicFid - re-enrollments
  // and multi-program families must never burn an id from the bounded 5001+ band.
  const preFamilySnap = await familyRef.get();
  const preAllocatedPublicFid =
    preFamilySnap.exists && !preFamilySnap.data()?.['publicFid']
      ? await allocateFamilyPublicId()
      : null;

  const result = await db.runTransaction(async (txn) => {
    const offeringRef = db.collection('offerings').doc(oid);
    const enrollmentRef = db
      .collection('families')
      .doc(fid)
      .collection('enrollments')
      .doc(eid);

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

    // Load the program for BOTH the active-gate AND its eligibility rules. Uses
    // the cached reader so it's cheap; failure aborts before any writes.
    const program = await getProgram(offering.programKey);
    if (!program || program.status !== 'active') throw new Error('program-not-available');

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

    // Read members AFTER early-exit checks so we only pay the cost when actually enrolling.
    const membersSnap = await txn.get(
      db.collection('families').doc(fid).collection('members'),
    );

    // Enroll exactly the members that pass the program's eligibility — the same
    // set the family sees on the enroll page (memberEligibleForProgram). BV
    // (memberType 'child') → children only (unchanged); 'any'/'adult' programs →
    // all matching members. Replaces the old children-only hardcode.
    const enrolledMids: string[] = [];
    for (const memberDoc of membersSnap.docs) {
      const m = memberDoc.data() as { type?: 'Adult' | 'Child'; mid?: string; birthMonthYear?: string | null };
      if (!m.mid || !m.type) continue;
      if (memberEligibleForProgram({ type: m.type, birthMonthYear: m.birthMonthYear ?? null }, program.eligibility, now)) {
        enrolledMids.push(m.mid);
      }
    }

    // Enrolling zero members is always meaningless (an adult-only family enrolling
    // in child-only Bala Vihar). Program-agnostic - never write an empty enrollment.
    if (enrolledMids.length === 0) {
      throw new Error('no-eligible-members');
    }

    // Commit the lazy publicFid mint. This is the family's FIRST successful
    // enrollment (an existing active enrollment already returned above; an
    // ineligible family already threw), so mint here - AFTER all txn reads
    // (Firestore requires every read before any write) and only if the txn's own
    // family read still shows no publicFid. A concurrent enrollment that already
    // minted one (rare TOCTOU) wins; preAllocatedPublicFid then goes unused - a
    // harmless gap (ids need not be contiguous), matching the allocator's
    // documented burn-on-skip behavior.
    if (preAllocatedPublicFid && !(familySnap.data() as Record<string, unknown>)['publicFid']) {
      txn.update(familyRef, { publicFid: preAllocatedPublicFid });
    }

    txn.set(enrollmentRef, {
      eid,
      fid,
      oid,
      pid: oid,
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
