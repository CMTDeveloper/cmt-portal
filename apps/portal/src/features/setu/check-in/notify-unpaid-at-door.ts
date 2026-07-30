import 'server-only';
import { resolveBvUnpaid } from '@/features/setu/donations/bv-unpaid';
import { notifyDonationPending } from '@/features/setu/donations/notify-donation-pending';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';

export interface NotifyUnpaidAtDoorArgs {
  fid: string;
  legacyFid: string | null | undefined;
}

/**
 * Trigger 2 for CMT's `bv_enrolled_donation_pending` (owner, 2026-07-30): the
 * family turns up at the door still owing the Bala Vihar donation.
 *
 * The door is where an unpaid family reliably appears in person, so it is the
 * one moment a nudge is certain to reach someone engaged. The 7-day cooldown
 * inside `notifyDonationPending` keeps it a nudge rather than a weekly form
 * letter, and is shared with the abandonment trigger so the two cannot compound.
 *
 * ── NEVER THROWS, and never delays a child being marked present ─────────────
 * Call it AFTER the check-in is written. A Sunday-morning queue is a real cost:
 * this adds reads plus an SES call to a request the sevak is watching. Every
 * failure here is recoverable - the check-in has happened and the family's
 * dashboard still shows the outstanding donation - so none of them may surface
 * at the door.
 *
 * ⚠️ KNOWN, ACCEPTED RACE: `resolveBvUnpaid` reads before
 * `notifyDonationPending` claims. A family who pays in those milliseconds could
 * receive the pending notice just after their confirmation. Closing it would
 * mean holding the payment state inside the claim transaction, which is a large
 * change to a door path for a window measured in milliseconds on a Sunday
 * morning when payments are rare. Documented rather than hidden.
 *
 * ── Ordering: decide PAID before claiming ───────────────────────────────────
 * The claim WRITES. Claiming first would stamp families who turn out to have
 * paid, and their next genuinely-unpaid week would then be silently skipped.
 */
export async function notifyUnpaidAtDoor(args: NotifyUnpaidAtDoorArgs): Promise<void> {
  try {
    const { eid, unpaid } = await resolveBvUnpaid(args.fid, args.legacyFid);
    if (!unpaid || !eid) return;

    // Only now - the kiosk resolves a family by its door number and never loads
    // members, and this is `use cache`d, so the common (paid, or already-nudged)
    // path never pays for it.
    const cached = await getFamilyByFid(args.fid);
    if (!cached) return;

    await notifyDonationPending({
      fid: args.fid,
      eid,
      members: cached.members,
      // No session at the kiosk: the sevak is signed in, not the family. Passing
      // no preferred mid lets bvEmailRecipient fall back to the manager, which
      // is the right recipient for a letter about the family's own donation.
      currentMid: null,
      managerMids: cached.family.managers ?? [],
    });
  } catch (err) {
    console.error(`[bv-email] door nudge failed for ${args.fid} (check-in already recorded)`, err);
  }
}
