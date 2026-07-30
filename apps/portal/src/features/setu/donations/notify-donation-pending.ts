import 'server-only';
import { bvEmailRecipient, sendBvDonationPendingEmail } from './bv-enrollment-emails';
import { claimPendingEmail } from './claim-pending-email';
import { portalBaseUrl } from '@/lib/portal-base-url';

export interface NotifyDonationPendingArgs {
  fid: string;
  /**
   * The Bala Vihar enrollment this is about. It carries the anti-spam stamp, so
   * without it there is nothing to claim and nothing is sent - a family with no
   * enrollment is not "enrolled but unpaid", they are simply not enrolled, and
   * CMT's copy ("We have received your enrollment…") would be false.
   */
  eid: string | null | undefined;
  members: readonly {
    mid: string;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }[];
  currentMid?: string | null | undefined;
  managerMids: readonly string[];
  /** Resolves the return origin. Omit on paths that have none (the cron). */
  req?: Request;
}

/**
 * "You are enrolled, but the donation is not finished" - CMT's
 * `bv_enrolled_donation_pending`.
 *
 * ── Where the family is sent back to ────────────────────────────────────────
 * `/family/enroll/bala-vihar`, the one-time/monthly CHOICE, and NOT
 * `/family/donate`. Two reasons, both learned the hard way:
 *   1. a bare `/family/donate` REDIRECTS to `/family` (only `?eid=` enrollment
 *      donations go through the portal), so the link would dump them on a
 *      dashboard with nothing to act on - the exact dead end Vaibhav reported
 *      about the Stripe cancel url on 2026-07-29; and
 *   2. the enroll page runs `clearAbandonedPledge` on render, so a family whose
 *      abandoned PAD attempt is still sitting in `started` gets it cleared and
 *      can actually choose again.
 * ABSOLUTE, via `portalBaseUrl` - it is a link in an email, and the allowlisted
 * host chain can never return a relative url or a caller-supplied host.
 *
 * ── The anti-spam claim lives HERE, not at the call sites ───────────────────
 * Unlike its `complete` sibling, this email has two independent triggers that
 * cannot see each other - a family bouncing off Stripe, and the kiosk on a
 * Sunday morning. Putting the claim inside means neither caller can forget it,
 * and adding a third trigger later cannot reintroduce the duplicate-mail bug.
 * See claimPendingEmail for the cooldown and why it fails closed.
 *
 * NEVER THROWS.
 */
export async function notifyDonationPending(args: NotifyDonationPendingArgs): Promise<void> {
  try {
    if (!args.eid) return;
    if (!(await claimPendingEmail(args.fid, args.eid))) return;

    const base = portalBaseUrl(args.req).replace(/\/+$/, '');
    await sendBvDonationPendingEmail(
      bvEmailRecipient(args.members, args.currentMid, args.managerMids),
      `${base}/family/enroll/bala-vihar`,
    );
  } catch (err) {
    console.error(`[bv-email] could not send the pending notice for ${args.fid}`, err);
  }
}
