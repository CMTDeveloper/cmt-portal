import 'server-only';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { getDonations } from '@/features/setu/donations/get-donations';
import { getFamilyPledge } from '@/features/setu/pledges/get-family-pledge';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { isPledgeGiving } from '@cmt/shared-domain/setu';
import { isBalaViharPaid } from '@/features/setu/adult-class/needs-selection';
import { selectBalaViharEnrollment } from '@/app/family/_helpers/select-bv-enrollment';
import { isLegacyBvPeriod } from '@/app/family/_helpers/dashboard-model';
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
 * one moment a nudge is certain to reach someone who is actually engaged. The
 * 7-day cooldown inside `notifyDonationPending` is what keeps this a nudge
 * rather than a weekly form letter.
 *
 * ── NEVER THROWS, and never delays a child being marked present ─────────────
 * Call it AFTER the check-in is written. A Sunday-morning queue is a real cost:
 * this adds ~3 reads plus an SES call to a request the sevak is watching. If any
 * of it fails or is slow, the check-in has already happened and the family's
 * dashboard still shows the outstanding donation - so every failure here is
 * recoverable and none of them may surface to the door.
 *
 * ── Ordering is deliberate: decide PAID before claiming ─────────────────────
 * The cooldown claim WRITES. Claiming first would stamp families who turn out
 * to have paid, and the next genuinely-unpaid week would then be silently
 * skipped. So the paid check - which is read-only - runs first, and only a
 * family that really owes reaches the claim.
 */
export async function notifyUnpaidAtDoor(args: NotifyUnpaidAtDoorArgs): Promise<void> {
  try {
    const enrollments = await getEnrollments(args.fid);
    // By programKey, never "first active": a Tabla or adult-class enrollment
    // would otherwise stand in for Bala Vihar and make this letter wrong.
    const bv = selectBalaViharEnrollment(enrollments);
    if (!bv) return;

    const [donations, pledge, legacyPaymentStatus] = await Promise.all([
      getDonations(args.fid),
      getFamilyPledge(args.fid),
      // The legacy leg reads the ENTIRE prod roster, so only pay for it when the
      // offering is actually legacy-sourced - the same predicate the dashboard
      // and the adult-class gate use, so the three cannot disagree about which
      // families it applies to.
      isLegacyBvPeriod(enrollments)
        ? getLegacyPaymentStatus(args.legacyFid)
        : Promise.resolve('unknown'),
    ]);

    // The SAME helper the adult-class waiver uses. A second hand-rolled
    // definition of "has this family paid Bala Vihar" would eventually disagree
    // with it, and this one decides whether we tell a family they still owe
    // money - the worst possible place to be wrong.
    const paid = isBalaViharPaid({
      bv,
      donations,
      legacyPaymentStatus,
      hasActivePledge: isPledgeGiving(pledge),
    });
    if (paid) return;

    // Only now - the kiosk resolves a family by its door number and never loads
    // members, and this is `use cache`d, so paying for it here costs nothing on
    // the common (already-paid, or already-nudged) path.
    const cached = await getFamilyByFid(args.fid);
    if (!cached) return;

    await notifyDonationPending({
      fid: args.fid,
      eid: bv.eid,
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
