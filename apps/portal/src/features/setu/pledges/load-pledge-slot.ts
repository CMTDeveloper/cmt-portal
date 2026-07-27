import 'server-only';
import { flags } from '@/lib/flags';
import { getFamilyPledge } from './get-family-pledge';
import { configuredMonthlyAmountCAD } from './pledge-amount';
import type { FamilyPledgeView } from './select-family-pledge';

export interface PledgeSlot {
  pledge: FamilyPledgeView | null;
  /** Today's price, for the ask. An existing pledge speaks its own snapshot. */
  askAmountCAD: number;
  canStart: boolean;
}

/**
 * Everything the pledge card needs, or `null` meaning "render nothing".
 *
 * Shared by the family dashboard and `/donate/success` so neither can forget
 * the two guarantees baked in here:
 *
 * 1. **Dark means dark.** With the flag off this returns before touching
 *    Firestore. The flag check living in the loader rather than in each caller
 *    is the difference between a guarantee and a convention.
 * 2. **Fail-soft.** A Firestore error costs the CARD, never the page. Both
 *    surfaces are things a family came to for something else - a receipt, their
 *    dashboard - and neither should 500 over an optional ask.
 */
export async function loadPledgeSlot(args: { fid: string; isManager: boolean }): Promise<PledgeSlot | null> {
  if (!flags.setuPledge) return null;
  try {
    return {
      pledge: await getFamilyPledge(args.fid),
      askAmountCAD: configuredMonthlyAmountCAD(),
      canStart: args.isManager,
    };
  } catch (err) {
    console.error('[pledge] could not read the family pledge - hiding the card', err);
    return null;
  }
}
