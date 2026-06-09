import 'server-only';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import type { RosterPayment } from '@cmt/shared-domain/setu';
import { sumCompletedDonations } from './donations-sum';

/**
 * Best-effort payment status for a family. NEVER throws — a derivation failure
 * for one family must not break the roster page (returns 'unknown').
 *  - no active enrollments        → 'unknown'
 *  - completed donations >= total → 'paid'
 *  - otherwise                    → 'outstanding'
 * Sums ALL active enrollments (N=2 safe), not the first.
 */
export async function deriveFamilyPayment(fid: string): Promise<RosterPayment> {
  try {
    const [enrollments, paid] = await Promise.all([getEnrollments(fid), sumCompletedDonations(fid)]);
    const active = enrollments.filter((e) => e.status === 'active');
    if (active.length === 0) return 'unknown';
    const expected = active.reduce((sum, e) => sum + (e.effectiveSuggestedAmount ?? 0), 0);
    if (expected <= 0) return 'unknown';
    return paid >= expected ? 'paid' : 'outstanding';
  } catch {
    return 'unknown';
  }
}
