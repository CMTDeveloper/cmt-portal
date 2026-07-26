import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { memberEligibleForProgram, resolveSuggestedAmount, type EnrollmentDoc, type OfferingDoc, type PricingTier } from '@cmt/shared-domain';
import { getProgram } from '@/features/setu/programs/get-programs';
import { ensurePublicFid } from './ensure-public-fid';

type EnrollVia = EnrollmentDoc['enrolledVia'];

export type EnrollFamilyParams = {
  fid: string;
  oid: string;
  enrolledVia: EnrollVia;
  enrolledByMid: string | null;
  /**
   * Explicit member selection. OMIT to keep the derive-from-eligibility
   * behaviour every existing caller relies on. Supplied by the Adult Study
   * Class, where the family names which non-teaching adult attends rather than
   * enrolling every adult in the household.
   */
  enrolledMids?: string[];
  /**
   * Per-family price override. OMIT to keep the hardcoded `null`. `0` is a
   * meaningful value (the Bala-Vihar-paid exemption), so this is distinguished
   * from "not supplied" by `undefined`, never by falsiness.
   */
  suggestedAmountOverride?: number | null;
  /**
   * `'manual'` freezes `enrolledMids` against the member-edit auto-prune, so a
   * family's explicit choice is not silently re-derived. OMIT → `'auto'`, which
   * is what absence has always meant.
   */
  membershipMode?: 'auto' | 'manual';
};

export type EnrollFamilyResult =
  | { created: true; eid: string; suggestedAmountSnapshot: number }
  // `reconciled` is present only when an existing ACTIVE enrollment was updated
  // in place. Omitted (not `false`) on the plain no-op, so a caller that only
  // checks `created` behaves exactly as it always has.
  | { created: false; reconciled?: true; eid: string; suggestedAmountSnapshot: number };

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
 * - After the enrollment commits, lazily mints the family's user-facing publicFid
 *   via ensurePublicFid (the single mint point under Model Y2; idempotent).
 *
 * Throws with message 'offering-not-found' | 'offering-disabled' | 'offering-expired'
 * | 'family-not-found' | 'program-not-available' | 'no-eligible-members' for caller
 * to translate to HTTP errors.
 */
export async function enrollFamily(params: EnrollFamilyParams): Promise<EnrollFamilyResult> {
  const { fid, oid, enrolledVia, enrolledByMid } = params;
  // Presence, not truthiness: an explicitly supplied `[]` must still reach the
  // no-eligible-members guard rather than silently falling back to deriving, and
  // a supplied `0` override is a real value (the Bala-Vihar-paid exemption).
  const midsSupplied = params.enrolledMids !== undefined;
  const overrideSupplied = params.suggestedAmountOverride !== undefined;
  const modeSupplied = params.membershipMode !== undefined;
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
        // RECONCILE. Patch ONLY what the caller explicitly supplied. Anything
        // else on an active enrollment is immutable here by design:
        // `suggestedAmountSnapshot` is pinned at first enrollment so a later tier
        // edit cannot move what an already-enrolled family owes, and `enrolledAt`
        // / `enrolledVia` / `enrolledByMid` are the historical record of how the
        // family got in. Re-deriving any of them on a re-POST would silently
        // rewrite money owed or provenance.
        const patch: Record<string, unknown> = {};
        if (midsSupplied) patch['enrolledMids'] = params.enrolledMids;
        if (overrideSupplied) patch['suggestedAmountOverride'] = params.suggestedAmountOverride;
        if (modeSupplied) patch['membershipMode'] = params.membershipMode;

        // Nothing supplied ⇒ byte-for-byte the previous no-op. Four existing
        // callers rely on this, including the door kiosk, whose documented
        // idempotency is precisely "a re-enroll writes nothing".
        if (Object.keys(patch).length === 0) {
          return { created: false as const, eid, suggestedAmountSnapshot: existing.suggestedAmountSnapshot };
        }

        // Same invariant as the create path: never leave an enrollment naming
        // nobody. An empty list would still satisfy "has an active enrollment"
        // for the adult-class gate while selecting no one. (The member-edit
        // prune MAY legitimately leave an empty list - that is a different
        // writer with a different job, and it is what makes the gate re-fire.)
        if (midsSupplied && params.enrolledMids!.length === 0) {
          throw new Error('no-eligible-members');
        }

        txn.update(enrollmentRef, patch);
        return {
          created: false as const,
          reconciled: true as const,
          eid,
          // The STORED snapshot, never the freshly resolved one above.
          suggestedAmountSnapshot: existing.suggestedAmountSnapshot,
        };
      }
    }

    // An explicit selection needs no member read at all; only derive when the
    // caller did not name the members.
    let enrolledMids: string[];
    if (midsSupplied) {
      enrolledMids = params.enrolledMids!;
    } else {
      // Read members AFTER early-exit checks so we only pay the cost when actually enrolling.
      const membersSnap = await txn.get(
        db.collection('families').doc(fid).collection('members'),
      );

      // Enroll exactly the members that pass the program's eligibility — the same
      // set the family sees on the enroll page (memberEligibleForProgram). BV
      // (memberType 'child') → children only (unchanged); 'any'/'adult' programs →
      // all matching members. Replaces the old children-only hardcode.
      enrolledMids = [];
      for (const memberDoc of membersSnap.docs) {
        const m = memberDoc.data() as { type?: 'Adult' | 'Child'; mid?: string; birthMonthYear?: string | null };
        if (!m.mid || !m.type) continue;
        if (memberEligibleForProgram({ type: m.type, birthMonthYear: m.birthMonthYear ?? null }, program.eligibility, now)) {
          enrolledMids.push(m.mid);
        }
      }
    }

    // Enrolling zero members is always meaningless (an adult-only family enrolling
    // in child-only Bala Vihar). Program-agnostic - never write an empty enrollment.
    // Deliberately applied to the SUPPLIED list too: an empty explicit selection
    // would otherwise write an enrollment that satisfies the adult-class gate's
    // "has an active enrollment" condition while naming nobody.
    if (enrolledMids.length === 0) {
      throw new Error('no-eligible-members');
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
      // `?? null`, never `|| null`: a supplied `0` is the Bala-Vihar-paid
      // exemption and must survive. Absent → null, exactly as before.
      suggestedAmountOverride: params.suggestedAmountOverride ?? null,
      status: 'active',
      cancelledAt: null,
      cancelledReason: null,
      // Always written, defaulting to 'auto' - which is exactly what absence has
      // always meant, so this is additive rather than a behaviour change.
      membershipMode: params.membershipMode ?? 'auto',
    });

    return { created: true as const, eid, suggestedAmountSnapshot };
  });

  // Lazy-mint the family's user-facing publicFid now that the enrollment has
  // committed - the single mint point under Model Y2. Idempotent (a family that
  // already has one keeps it). Best-effort: the enrollment already succeeded, so
  // a transient mint failure must not fail it - the id mints on the family's next
  // engagement (ensurePublicFid is idempotent).
  try {
    await ensurePublicFid(fid);
  } catch (e) {
    console.error('[enrollFamily] publicFid mint failed (enrollment already committed)', e);
  }

  return result;
}
