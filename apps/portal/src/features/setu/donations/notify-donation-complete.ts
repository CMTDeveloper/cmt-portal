import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { bvEmailRecipient, sendBvDonationCompleteEmail } from './bv-enrollment-emails';

export interface NotifyDonationCompleteArgs {
  did: string;
  fid: string;
  members: readonly {
    mid: string;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }[];
  /** The signed-in member, who is the one this confirmation is addressed to. */
  currentMid: string | null | undefined;
  managerMids: readonly string[];
}

/**
 * Tell the family their one-time Bala Vihar donation arrived.
 *
 * ── Call this ONLY on a real transition ─────────────────────────────────────
 * It sends unconditionally. The once-only guard lives at the call site, on
 * `markDonationStatus(...).changed`, because that is where the transaction that
 * claims the transition runs - and a family reloading their receipt must not be
 * mailed again. Do not "helpfully" call this from a render path that has not
 * just won a transition.
 *
 * ── The amount is re-read, not passed in ────────────────────────────────────
 * From the donation document itself, so the figure in the email is the one the
 * portal recorded rather than anything a URL or a component prop claimed. This
 * email states a dollar amount to a donor; the cost of it disagreeing with the
 * receipt is a phone call to the office, and the cost of the extra read is one
 * document.
 *
 * NEVER THROWS - Stripe already has the money.
 */
export async function notifyDonationComplete(args: NotifyDonationCompleteArgs): Promise<void> {
  try {
    const snap = await portalFirestore().collection('donations').doc(args.did).get();
    if (!snap.exists) return;
    const data = snap.data() as { fid?: unknown; amountCAD?: unknown } | undefined;
    // The same cross-family guard markDonationStatus applies. This function is
    // exported and could be called from somewhere that has not checked.
    if (!data || data.fid !== args.fid) return;

    const amount = typeof data.amountCAD === 'number' ? data.amountCAD : null;
    // A donation with no readable amount would render "CAD $" - worse than
    // silence, because it looks like a system that lost the family's money.
    if (amount == null) {
      console.error(`[bv-email] donation ${args.did} has no numeric amountCAD - not confirming`);
      return;
    }

    await sendBvDonationCompleteEmail(
      bvEmailRecipient(args.members, args.currentMid, args.managerMids),
      amount,
    );
  } catch (err) {
    console.error(`[bv-email] could not confirm donation ${args.did}`, err);
  }
}
