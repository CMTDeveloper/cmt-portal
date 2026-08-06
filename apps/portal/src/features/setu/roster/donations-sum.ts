import 'server-only';
import { getDonations } from '@/features/setu/donations/get-donations';
import type { DonationDoc } from '@cmt/shared-domain';

/**
 * Sum of completed donation amounts (CAD) from donations ALREADY read.
 *
 * Pure, and separate from the fetch below, so a caller that needs the donation
 * ROWS as well as their total pays for one read instead of two. The family
 * detail screen needs both - the total feeds the payment verdict, the rows feed
 * the history staff read on the phone - and before this split it would have run
 * the same `donations(fid)` query twice to get them.
 *
 * ⚠️ LIFETIME, not year-scoped (task #117). Every surface that prints this
 * number must say "all time"; calling it "paid this year" would be false for
 * any family who has been with CMT longer than one.
 */
export function sumCompleted(donations: readonly DonationDoc[]): number {
  return donations
    .filter((d) => d.status === 'completed')
    .reduce((sum, d) => sum + (typeof d.amountCAD === 'number' ? d.amountCAD : 0), 0);
}

/** Sum of completed donation amounts (CAD) for a family. */
export async function sumCompletedDonations(fid: string): Promise<number> {
  return sumCompleted(await getDonations(fid));
}
