import 'server-only';
import { getDonations } from '@/features/setu/donations/get-donations';

/** Sum of completed donation amounts (CAD) for a family. */
export async function sumCompletedDonations(fid: string): Promise<number> {
  const donations = await getDonations(fid);
  return donations
    .filter((d) => d.status === 'completed')
    .reduce((sum, d) => sum + (typeof d.amountCAD === 'number' ? d.amountCAD : 0), 0);
}
