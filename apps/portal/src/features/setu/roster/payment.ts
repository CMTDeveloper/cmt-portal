import 'server-only';
import { getEnrollments, type EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import { classifyRosterPayment, type ActiveEnrollmentCharge } from '@cmt/shared-domain/setu';
import type { OfferingDoc, RosterPayment } from '@cmt/shared-domain/setu';
import { sumCompletedDonations } from './donations-sum';

/**
 * The one adapter from a joined enrollment to a payment charge.
 *
 * Deliberately NOT `e.effectiveSuggestedAmount`: that field collapses a missing
 * offering onto the enroll-time snapshot, so an enrollment nobody ever priced
 * arrives here as a confident `0` and would be reported as owing nothing.
 * `chargeAmount` needs the raw pieces to tell those apart.
 */
export function chargeFromEnrollment(e: EnrollmentWithOffering): ActiveEnrollmentCharge {
  return {
    override: e.suggestedAmountOverride ?? null,
    snapshot: e.suggestedAmountSnapshot,
    offering: e.offering,
    enrolledAt: e.enrolledAt,
  };
}

/** One active enrollment as the two bulk roster passes hold it. */
export interface BulkActiveEnrollment {
  oid: string;
  override: number | null;
  snapshot: number;
  enrolledAt: Date;
}

/**
 * The same verdict for the bulk passes, which hold offerings in a map keyed by
 * oid rather than joined onto each enrollment. Exists so neither of them
 * re-derives the override → offering → snapshot fallback by hand; that chain
 * lives in `chargeAmount` and nowhere else.
 */
export function classifyBulkPayment(
  active: readonly BulkActiveEnrollment[],
  offerings: ReadonlyMap<string, Pick<OfferingDoc, 'pricingTiers' | 'paymentSource'>>,
  paidCAD: number,
): RosterPayment {
  return classifyRosterPayment(
    active.map((a) => ({
      override: a.override,
      snapshot: a.snapshot,
      offering: offerings.get(a.oid) ?? null,
      enrolledAt: a.enrolledAt,
    })),
    paidCAD,
  );
}

/**
 * Best-effort payment status for a family. NEVER throws — a derivation failure
 * for one family must not break the roster page (returns 'unknown').
 * Classifies ALL active enrollments (N=2 safe), not the first.
 */
export async function deriveFamilyPayment(fid: string): Promise<RosterPayment> {
  try {
    const [enrollments, paid] = await Promise.all([getEnrollments(fid), sumCompletedDonations(fid)]);
    const active = enrollments.filter((e) => e.status === 'active');
    return classifyRosterPayment(active.map(chargeFromEnrollment), paid);
  } catch {
    return 'unknown';
  }
}
