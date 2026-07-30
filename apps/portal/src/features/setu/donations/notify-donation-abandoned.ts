import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { BALA_VIHAR } from '@cmt/shared-domain';
import { resolveBvUnpaid } from './bv-unpaid';
import { notifyDonationPending } from './notify-donation-pending';

export interface NotifyDonationAbandonedArgs {
  /** The donation that was just abandoned. The letter is about THIS donation. */
  did: string;
  fid: string;
  legacyFid: string | null | undefined;
  members: readonly {
    mid: string;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }[];
  currentMid?: string | null | undefined;
  managerMids: readonly string[];
}

/**
 * "You backed out of Stripe and Bala Vihar is still unpaid" - the abandonment
 * half of CMT's `bv_enrolled_donation_pending`.
 *
 * ── Two guards, both added after a Codex review (2026-07-30) ────────────────
 * The first version keyed only on "a donation was abandoned" and then looked up
 * the family's Bala Vihar enrollment independently, which was wrong twice:
 *
 *   1. WRONG PROGRAMME. Every programme's checkout returns to the same cancel
 *      page, so abandoning a TABLA or ADULT-CLASS payment sent a letter about
 *      Bala Vihar. The donation doc carries `programKey` and `eid`; this now
 *      requires both to be the Bala Vihar enrollment donation.
 *   2. ALREADY PAID. It never asked whether Bala Vihar was settled, so a family
 *      who had paid in September - or who is paying MONTHLY - could abandon an
 *      unrelated checkout in November and be told their enrollment was not
 *      confirmed. `resolveBvUnpaid` is now the gate.
 *
 * Call it only on a real `→ abandoned` transition; `notifyDonationPending`
 * additionally enforces the 7-day cooldown that stops this compounding with the
 * door trigger.
 *
 * NEVER THROWS.
 */
export async function notifyDonationAbandoned(args: NotifyDonationAbandonedArgs): Promise<void> {
  try {
    const snap = await portalFirestore().collection('donations').doc(args.did).get();
    if (!snap.exists) return;
    const data = snap.data() as
      | { fid?: unknown; programKey?: unknown; eid?: unknown }
      | undefined;
    if (!data || data.fid !== args.fid) return;
    if (data.programKey !== BALA_VIHAR || typeof data.eid !== 'string' || data.eid === '') return;

    // Ask the shared rule, not the donation doc: the family may have paid Bala
    // Vihar through a DIFFERENT donation, or be on a monthly pledge, either of
    // which makes this letter false.
    const { eid, unpaid } = await resolveBvUnpaid(args.fid, args.legacyFid);
    if (!unpaid) return;

    await notifyDonationPending({
      fid: args.fid,
      eid,
      members: args.members,
      currentMid: args.currentMid,
      managerMids: args.managerMids,
    });
  } catch (err) {
    console.error(`[bv-email] could not handle the abandoned donation ${args.did}`, err);
  }
}
