import 'server-only';
import { resolveBvUnpaid } from '@/features/setu/donations/bv-unpaid';
import { notifyDonationPending } from '@/features/setu/donations/notify-donation-pending';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';

export interface NotifyPledgeAbandonedArgs {
  fid: string;
  /** Present on the route paths; omitted by server components, which have none. */
  req?: Request;
}

/**
 * Trigger 3 for CMT's `bv_enrolled_donation_pending`: the family chose the
 * MONTHLY option, never authorised the mandate, and the attempt has just been
 * cleared.
 *
 * ── The gap this closes (Vaibhav, 2026-07-30) ───────────────────────────────
 * *"i did not get donation pending email for family15@gmail.com when I tried PAD
 * option, and cancelled"*.
 *
 * He was right, and the cause was structural rather than a misfire.
 * `notifyDonationAbandoned` is keyed on a `did` and had exactly two callers -
 * `/family/donate/cancel` and the donation status route - both reachable only
 * with a donations document in hand. The pledge flow never creates one: it
 * writes a `pledges` doc and sends the family to `/family/enroll/bala-vihar`,
 * which calls `clearAbandonedPledge` and nothing else. So abandoning the monthly
 * option was silent BY CONSTRUCTION, and no amount of retrying could have
 * produced the letter. Confirmed against UAT: family15 has an active Bala Vihar
 * enrollment, ZERO donations, one `cancelled` pledge, and no `pendingEmailSentAt`
 * stamp - the claim was never even attempted.
 *
 * ── Same two guards as the one-time path, for the same reasons ──────────────
 * `resolveBvUnpaid` decides whether the family actually owes anything, so a
 * family who already paid - or who is on a LIVE monthly pledge and abandoned a
 * second attempt - is never told their enrollment is unconfirmed. And the 7-day
 * cooldown lives inside `notifyDonationPending`, shared with the door and
 * one-time triggers, so the three cannot compound into three letters in a
 * morning.
 *
 * NEVER THROWS. Its callers are server components rendering a whole page; a mail
 * failure must not cost the family their dashboard.
 */
export async function notifyPledgeAbandoned(args: NotifyPledgeAbandonedArgs): Promise<void> {
  try {
    // The family first, because `resolveBvUnpaid` needs the legacyFid to decide
    // whether the legacy roster is even worth reading.
    const cached = await getFamilyByFid(args.fid);
    if (!cached) return;

    const { eid, unpaid } = await resolveBvUnpaid(args.fid, cached.family.legacyFid);
    if (!unpaid || !eid) return;

    await notifyDonationPending({
      fid: args.fid,
      eid,
      members: cached.members,
      // The manager is who owes the donation and who authorised the mandate;
      // bvEmailRecipient falls back to them when no preferred mid is given.
      currentMid: null,
      managerMids: cached.family.managers ?? [],
      ...(args.req ? { req: args.req } : {}),
    });
  } catch (err) {
    console.error(`[bv-email] abandoned-pledge notice failed for ${args.fid}`, err);
  }
}
